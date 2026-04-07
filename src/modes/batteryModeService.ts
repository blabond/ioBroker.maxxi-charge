import type {
  AdapterInstance,
  RuntimeConfig,
  StateChange,
} from "../types/shared";
import {
  BATTERY_CALIBRATION_EMPTY_SOC,
  BATTERY_CALIBRATION_FULL_SOC,
} from "../constants";
import { updateAdapterNativeConfig } from "../utils/adapterConfigStore";
import { extractRelativeId } from "../utils/helpers";
import type CommandService from "../commands/commandService";
import type DeviceRegistry from "../core/deviceRegistry";

export default class BatteryModeService {
  private readonly calibrationAppliedDeviceIds = new Set<string>();

  public constructor(
    private readonly adapter: AdapterInstance,
    private readonly config: RuntimeConfig,
    private readonly commandService: CommandService,
    private readonly deviceRegistry: DeviceRegistry,
  ) {}

  public async start(): Promise<void> {
    if (!this.config.batteryCalibrationEnabled) {
      return;
    }

    await this.applyCalibrationToDevices(
      this.deviceRegistry.getActiveDeviceIds(),
    );
  }

  public async handleDeviceAvailable(deviceId: string): Promise<void> {
    const normalizedDeviceId = deviceId.trim();
    if (
      !normalizedDeviceId ||
      !this.config.batteryCalibrationEnabled ||
      this.calibrationAppliedDeviceIds.has(normalizedDeviceId)
    ) {
      return;
    }

    const applied = await this.applyCalibration(normalizedDeviceId);
    if (applied) {
      this.calibrationAppliedDeviceIds.add(normalizedDeviceId);
    }
  }

  public handleDeviceInactive(deviceId: string): void {
    const normalizedDeviceId = deviceId.trim();
    if (!normalizedDeviceId) {
      return;
    }

    this.calibrationAppliedDeviceIds.delete(normalizedDeviceId);
  }

  public handleConnectionLost(): void {
    this.calibrationAppliedDeviceIds.clear();
  }

  public async handleSocChange(id: string, state: StateChange): Promise<void> {
    if (
      !this.config.batteryCalibrationEnabled ||
      !state?.ack ||
      typeof state.val !== "number"
    ) {
      return;
    }

    const deviceId = this.extractDeviceId(id);
    if (!deviceId) {
      return;
    }

    if (
      this.config.calibrationProgress === "down" &&
      state.val <= BATTERY_CALIBRATION_EMPTY_SOC
    ) {
      const changed = await this.updateCalibrationState(true, "up");
      if (changed) {
        this.calibrationAppliedDeviceIds.clear();
        await this.applyCalibrationToDevices(
          this.deviceRegistry.getActiveDeviceIds(),
        );
      }
      return;
    }

    if (
      this.config.calibrationProgress === "up" &&
      state.val >= BATTERY_CALIBRATION_FULL_SOC
    ) {
      const changed = await this.updateCalibrationState(false, "down");
      if (changed) {
        this.calibrationAppliedDeviceIds.clear();
        this.calibrationAppliedDeviceIds.delete(deviceId);
      }
    }
  }

  public dispose(): Promise<void> {
    this.calibrationAppliedDeviceIds.clear();
    return Promise.resolve();
  }

  private async applyCalibrationToDevices(deviceIds: string[]): Promise<void> {
    for (const deviceId of deviceIds) {
      await this.handleDeviceAvailable(deviceId);
    }
  }

  private extractDeviceId(fullId: string): string {
    const relativeId = extractRelativeId(this.adapter.namespace, fullId);
    if (!relativeId) {
      return "";
    }

    return relativeId.split(".")[0] ?? "";
  }

  private async applyCalibration(deviceId: string): Promise<boolean> {
    try {
      if (this.config.calibrationProgress === "down") {
        const minSocUpdated = await this.commandService.applyDeviceSetting(
          deviceId,
          "minSOC",
          0,
          { source: "batteryMode:down" },
        );
        const maxSocUpdated = await this.commandService.applyDeviceSetting(
          deviceId,
          "maxSOC",
          100,
          { source: "batteryMode:down" },
        );
        return minSocUpdated && maxSocUpdated;
      }

      if (this.config.calibrationProgress === "up") {
        const minSocUpdated = await this.commandService.applyDeviceSetting(
          deviceId,
          "minSOC",
          99,
          { source: "batteryMode:up" },
        );
        const maxSocUpdated = await this.commandService.applyDeviceSetting(
          deviceId,
          "maxSOC",
          100,
          { source: "batteryMode:up" },
        );
        return minSocUpdated && maxSocUpdated;
      }

      return false;
    } catch (error) {
      this.adapter.log.error(
        `BatteryMode: Calibration failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }
  }

  private async updateCalibrationState(
    enabled: boolean,
    progress: "down" | "up",
  ): Promise<boolean> {
    if (
      this.config.batteryCalibrationEnabled === enabled &&
      this.config.calibrationProgress === progress
    ) {
      return false;
    }

    try {
      await updateAdapterNativeConfig(this.adapter, {
        batterycalibration: enabled,
        calibrationProgress: progress,
      });

      this.config.batteryCalibrationEnabled = enabled;
      this.config.calibrationProgress = progress;

      if (!enabled) {
        this.calibrationAppliedDeviceIds.clear();
      }

      this.adapter.log.debug(
        `BatteryMode: Updated calibration state to enabled=${enabled}, progress=${progress}.`,
      );
      return true;
    } catch (error) {
      this.adapter.log.error(
        `BatteryMode: Failed to update adapter config: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }
  }
}
