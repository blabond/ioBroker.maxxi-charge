import type {
  AdapterInstance,
  RuntimeConfig,
  StateChange,
} from "../types/shared";
import { updateAdapterNativeConfig } from "../utils/adapterConfigStore";
import type CommandService from "../commands/commandService";
import type DeviceRegistry from "../core/deviceRegistry";

export default class BatteryModeService {
  private calibrationAppliedForConnection = false;

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

    const activeDeviceId = this.deviceRegistry.getPrimaryDeviceId();
    if (activeDeviceId) {
      await this.handleDeviceAvailable(activeDeviceId);
    }
  }

  public async handleDeviceAvailable(deviceId: string): Promise<void> {
    if (
      !this.config.batteryCalibrationEnabled ||
      this.calibrationAppliedForConnection
    ) {
      return;
    }

    const applied = await this.applyCalibration(deviceId);
    if (applied) {
      this.calibrationAppliedForConnection = true;
    }
  }

  public handleConnectionLost(): void {
    this.calibrationAppliedForConnection = false;
  }

  public async handleSocChange(_id: string, state: StateChange): Promise<void> {
    if (
      !this.config.batteryCalibrationEnabled ||
      !state?.ack ||
      typeof state.val !== "number"
    ) {
      return;
    }

    if (this.config.calibrationProgress === "down" && state.val <= 10) {
      await this.updateCalibrationState(true, "up");
      return;
    }

    if (this.config.calibrationProgress === "up" && state.val >= 98) {
      await this.updateCalibrationState(false, "down");
    }
  }

  public dispose(): Promise<void> {
    this.calibrationAppliedForConnection = false;
    return Promise.resolve();
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
  ): Promise<void> {
    try {
      await updateAdapterNativeConfig(this.adapter, {
        batterycalibration: enabled,
        calibrationProgress: progress,
      });

      this.config.batteryCalibrationEnabled = enabled;
      this.config.calibrationProgress = progress;

      if (!enabled) {
        this.calibrationAppliedForConnection = false;
      }

      this.adapter.log.debug(
        `BatteryMode: Updated calibration state to enabled=${enabled}, progress=${progress}.`,
      );
    } catch (error) {
      this.adapter.log.error(
        `BatteryMode: Failed to update adapter config: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
