import { BKW_SOC_THRESHOLD } from "../constants";
import type {
  AdapterInstance,
  RuntimeConfig,
  StateChange,
} from "../types/shared";
import { extractRelativeId } from "../utils/helpers";
import type CommandService from "../commands/commandService";
import type DeviceRegistry from "../core/deviceRegistry";
import type StateManager from "../core/stateManager";

const BKW_MODE_RESTORE_PENDING_STATE_ID = "info.bkwModeRestorePending";

export default class BkwModeService {
  private lastState: "high" | "low" | null = null;

  private restorePending = false;

  private restoreCheckPending = false;

  public constructor(
    private readonly adapter: AdapterInstance,
    private readonly config: RuntimeConfig,
    private readonly commandService: CommandService,
    private readonly deviceRegistry: DeviceRegistry,
    private readonly stateManager: StateManager,
  ) {}

  public async start(): Promise<void> {
    this.restorePending = await this.readRestorePendingState();

    if (this.config.bkwEnabled || !this.restorePending) {
      return;
    }

    const activeDeviceId = this.deviceRegistry.getPrimaryDeviceId();
    if (activeDeviceId) {
      await this.restoreConfiguredBaseLoad(activeDeviceId, "startup");
      return;
    }

    this.restoreCheckPending = true;
  }

  public async handleDeviceAvailable(deviceId: string): Promise<void> {
    if (!this.restoreCheckPending || this.config.bkwEnabled) {
      return;
    }

    await this.restoreConfiguredBaseLoad(deviceId, "deviceAvailable");
  }

  public handleConnectionLost(): void {
    this.lastState = null;
  }

  public async handleSocChange(id: string, state: StateChange): Promise<void> {
    if (
      !state?.ack ||
      typeof state.val !== "number" ||
      !this.config.bkwEnabled ||
      this.config.batteryCalibrationEnabled
    ) {
      return;
    }

    const deviceId =
      this.extractDeviceId(id) ?? this.deviceRegistry.getPrimaryDeviceId();
    if (!deviceId) {
      return;
    }

    let nextState: "high" | "low" | null = null;
    let targetValue: number | null = null;

    if (state.val >= BKW_SOC_THRESHOLD && this.lastState !== "high") {
      targetValue = -this.config.bkwPowerTarget;
      nextState = "high";
    } else if (state.val < BKW_SOC_THRESHOLD && this.lastState !== "low") {
      targetValue = this.config.bkwAdjustment;
      nextState = "low";
    }

    if (targetValue === null) {
      return;
    }

    const updated = await this.commandService.applyDeviceSetting(
      deviceId,
      "baseLoad",
      targetValue,
      { source: "bkwMode" },
    );

    if (updated) {
      this.lastState = nextState;
      await this.markRestorePending();
      this.adapter.log.debug(
        `BkwMode: baseLoad set to ${targetValue} W for ${deviceId} (SOC=${state.val}%).`,
      );
    }
  }

  public dispose(): Promise<void> {
    this.lastState = null;
    this.restoreCheckPending = false;
    return Promise.resolve();
  }

  private extractDeviceId(fullId: string): string | null {
    const relativeId = extractRelativeId(this.adapter.namespace, fullId);
    if (!relativeId) {
      return null;
    }

    return relativeId.split(".")[0] ?? null;
  }

  private async markRestorePending(): Promise<void> {
    if (this.restorePending) {
      return;
    }

    await this.stateManager.setStateIfChanged(
      BKW_MODE_RESTORE_PENDING_STATE_ID,
      true,
      true,
    );
    this.restorePending = true;
  }

  private async restoreConfiguredBaseLoad(
    deviceId: string,
    reason: "startup" | "deviceAvailable",
  ): Promise<void> {
    if (!this.restorePending || this.config.bkwEnabled) {
      this.restoreCheckPending = false;
      return;
    }

    const restored = await this.commandService.applyDeviceSetting(
      deviceId,
      "baseLoad",
      this.config.bkwAdjustment,
      { source: `bkwMode:restore:${reason}` },
    );

    if (!restored) {
      this.adapter.log.warn(
        `BkwMode: Failed to restore configured baseLoad ${this.config.bkwAdjustment} W for ${deviceId}.`,
      );
      return;
    }

    await this.stateManager.setStateIfChanged(
      BKW_MODE_RESTORE_PENDING_STATE_ID,
      false,
      true,
    );

    this.lastState = null;
    this.restorePending = false;
    this.restoreCheckPending = false;
    this.adapter.log.debug(
      `BkwMode: Restored configured baseLoad ${this.config.bkwAdjustment} W for ${deviceId}.`,
    );
  }

  private async readRestorePendingState(): Promise<boolean> {
    const state = await this.adapter.getStateAsync(
      BKW_MODE_RESTORE_PENDING_STATE_ID,
    );

    return state?.val === true || state?.val === 1 || state?.val === "1";
  }
}
