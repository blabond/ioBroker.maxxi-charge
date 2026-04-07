import { BKW_SOC_THRESHOLD } from "../constants";
import type {
  AdapterInstance,
  RuntimeConfig,
  StateChange,
} from "../types/shared";
import { extractRelativeId, normalizeDeviceId } from "../utils/helpers";
import type CommandService from "../commands/commandService";
import type DeviceRegistry from "../core/deviceRegistry";
import type StateManager from "../core/stateManager";

const BKW_MODE_RESTORE_PENDING_STATE_SUFFIX = "_bkwModeRestorePending";

export default class BkwModeService {
  private readonly lastStateByDevice = new Map<string, "high" | "low">();

  private readonly initializedDeviceIds = new Set<string>();

  private readonly maxSocForcedDeviceIds = new Set<string>();

  public constructor(
    private readonly adapter: AdapterInstance,
    private readonly config: RuntimeConfig,
    private readonly commandService: CommandService,
    private readonly deviceRegistry: DeviceRegistry,
    private readonly stateManager: StateManager,
  ) {}

  public async start(): Promise<void> {
    for (const deviceId of this.deviceRegistry.getActiveDeviceIds()) {
      await this.handleDeviceAvailable(deviceId);
    }
  }

  public async handleDeviceAvailable(deviceId: string): Promise<void> {
    const normalizedDeviceId = normalizeDeviceId(deviceId);
    if (!normalizedDeviceId) {
      return;
    }

    if (this.initializedDeviceIds.has(normalizedDeviceId)) {
      return;
    }

    let handled = false;

    if (this.config.bkwEnabled) {
      handled = await this.evaluateCurrentSoc(normalizedDeviceId);
    } else {
      handled = await this.restoreConfiguredBaseLoad(
        normalizedDeviceId,
        "deviceAvailable",
      );
    }

    if (handled) {
      this.initializedDeviceIds.add(normalizedDeviceId);
    }
  }

  public handleDeviceInactive(deviceId: string): void {
    const normalizedDeviceId = normalizeDeviceId(deviceId);
    if (!normalizedDeviceId) {
      return;
    }

    this.clearDeviceState(normalizedDeviceId);
  }

  public handleConnectionLost(): void {
    this.lastStateByDevice.clear();
    this.initializedDeviceIds.clear();
    this.maxSocForcedDeviceIds.clear();
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

    const bkwPrepared = await this.ensureBkwOperatingMode(deviceId);
    if (!bkwPrepared) {
      return;
    }

    const lastState = this.lastStateByDevice.get(deviceId) ?? null;

    let nextState: "high" | "low" | null = null;
    let targetValue: number | null = null;

    if (state.val >= BKW_SOC_THRESHOLD && lastState !== "high") {
      targetValue = -this.config.bkwPowerTarget;
      nextState = "high";
    } else if (state.val < BKW_SOC_THRESHOLD && lastState !== "low") {
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
      if (nextState) {
        this.lastStateByDevice.set(deviceId, nextState);
      }
      await this.markRestorePending(deviceId);
      this.adapter.log.debug(
        `BkwMode: baseLoad set to ${targetValue} W for ${deviceId} (SOC=${state.val}%).`,
      );
    }
  }

  public dispose(): Promise<void> {
    this.lastStateByDevice.clear();
    this.initializedDeviceIds.clear();
    this.maxSocForcedDeviceIds.clear();
    return Promise.resolve();
  }

  private clearDeviceState(deviceId: string): void {
    this.lastStateByDevice.delete(deviceId);
    this.initializedDeviceIds.delete(deviceId);
    this.maxSocForcedDeviceIds.delete(deviceId);
  }

  private extractDeviceId(fullId: string): string | null {
    const relativeId = extractRelativeId(this.adapter.namespace, fullId);
    if (!relativeId) {
      return null;
    }

    return relativeId.split(".")[0] ?? null;
  }

  private async markRestorePending(deviceId: string): Promise<void> {
    const restorePending = await this.readRestorePendingState(deviceId);
    if (restorePending) {
      return;
    }

    await this.stateManager.setStateIfChanged(
      this.getRestorePendingStateId(deviceId),
      true,
      true,
    );
  }

  private async restoreConfiguredBaseLoad(
    deviceId: string,
    reason: "deviceAvailable",
  ): Promise<boolean> {
    const restorePending = await this.readRestorePendingState(deviceId);
    if (!restorePending || this.config.bkwEnabled) {
      return true;
    }

    const maxSocRestored = await this.commandService.applyDeviceSetting(
      deviceId,
      "maxSOC",
      this.config.feedInMode,
      { source: `bkwMode:restore:${reason}` },
    );
    const baseLoadRestored = await this.commandService.applyDeviceSetting(
      deviceId,
      "baseLoad",
      this.config.bkwAdjustment,
      { source: `bkwMode:restore:${reason}` },
    );

    if (!maxSocRestored || !baseLoadRestored) {
      this.adapter.log.warn(
        `BkwMode: Failed to restore configured settings for ${deviceId} (baseLoad=${this.config.bkwAdjustment} W, maxSOC=${this.config.feedInMode}%).`,
      );
      return false;
    }

    await this.stateManager.setStateIfChanged(
      this.getRestorePendingStateId(deviceId),
      false,
      true,
    );

    this.lastStateByDevice.delete(deviceId);
    this.maxSocForcedDeviceIds.delete(deviceId);
    this.adapter.log.debug(
      `BkwMode: Restored configured settings for ${deviceId} (baseLoad=${this.config.bkwAdjustment} W, maxSOC=${this.config.feedInMode}%).`,
    );
    return true;
  }

  private async readRestorePendingState(deviceId: string): Promise<boolean> {
    await this.ensureRestorePendingState(deviceId);

    const state = await this.adapter.getStateAsync(
      this.getRestorePendingStateId(deviceId),
    );

    return state?.val === true || state?.val === 1 || state?.val === "1";
  }

  private async ensureRestorePendingState(deviceId: string): Promise<void> {
    const stateId = this.getRestorePendingStateId(deviceId);

    await this.stateManager.ensureStateObject(stateId, {
      name: {
        en: "BKW mode baseLoad restore pending",
        de: "BKW-Modus BaseLoad-Wiederherstellung ausstehend",
      },
      type: "boolean",
      role: "indicator",
      read: true,
      write: false,
      expert: true,
      hidden: true,
      def: false,
    });

    const state = await this.adapter.getStateAsync(stateId);
    if (!state) {
      await this.adapter.setStateAsync(stateId, {
        val: false,
        ack: true,
      });
    }
  }

  private getRestorePendingStateId(deviceId: string): string {
    return `${deviceId}.${BKW_MODE_RESTORE_PENDING_STATE_SUFFIX}`;
  }

  private async evaluateCurrentSoc(deviceId: string): Promise<boolean> {
    const state = await this.adapter.getStateAsync(`${deviceId}.SOC`);
    if (!state?.ack || typeof state.val !== "number") {
      this.adapter.log.debug(
        `BkwMode: No valid current SOC state available for ${deviceId} during initialization.`,
      );
      return false;
    }

    await this.handleSocChange(
      `${this.adapter.namespace}.${deviceId}.SOC`,
      state,
    );
    return true;
  }

  private async ensureBkwOperatingMode(deviceId: string): Promise<boolean> {
    if (this.maxSocForcedDeviceIds.has(deviceId)) {
      return true;
    }

    const maxSocUpdated = await this.commandService.applyDeviceSetting(
      deviceId,
      "maxSOC",
      100,
      { source: "bkwMode:activate" },
    );
    if (!maxSocUpdated) {
      this.adapter.log.warn(
        `BkwMode: Failed to force maxSOC=100 for ${deviceId}.`,
      );
      return false;
    }

    await this.markRestorePending(deviceId);
    this.maxSocForcedDeviceIds.add(deviceId);
    return true;
  }
}
