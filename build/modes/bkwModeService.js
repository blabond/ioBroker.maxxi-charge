"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const constants_1 = require("../constants");
const helpers_1 = require("../utils/helpers");
const BKW_MODE_RESTORE_PENDING_STATE_ID = "info.bkwModeRestorePending";
class BkwModeService {
  adapter;
  config;
  commandService;
  deviceRegistry;
  stateManager;
  lastState = null;
  restorePending = false;
  restoreCheckPending = false;
  constructor(adapter, config, commandService, deviceRegistry, stateManager) {
    this.adapter = adapter;
    this.config = config;
    this.commandService = commandService;
    this.deviceRegistry = deviceRegistry;
    this.stateManager = stateManager;
  }
  async start() {
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
  async handleDeviceAvailable(deviceId) {
    if (!this.restoreCheckPending || this.config.bkwEnabled) {
      return;
    }
    await this.restoreConfiguredBaseLoad(deviceId, "deviceAvailable");
  }
  handleConnectionLost() {
    this.lastState = null;
  }
  async handleSocChange(id, state) {
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
    let nextState = null;
    let targetValue = null;
    if (
      state.val >= constants_1.BKW_SOC_THRESHOLD &&
      this.lastState !== "high"
    ) {
      targetValue = -this.config.bkwPowerTarget;
      nextState = "high";
    } else if (
      state.val < constants_1.BKW_SOC_THRESHOLD &&
      this.lastState !== "low"
    ) {
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
  dispose() {
    this.lastState = null;
    this.restoreCheckPending = false;
    return Promise.resolve();
  }
  extractDeviceId(fullId) {
    const relativeId = (0, helpers_1.extractRelativeId)(
      this.adapter.namespace,
      fullId,
    );
    if (!relativeId) {
      return null;
    }
    return relativeId.split(".")[0] ?? null;
  }
  async markRestorePending() {
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
  async restoreConfiguredBaseLoad(deviceId, reason) {
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
  async readRestorePendingState() {
    const state = await this.adapter.getStateAsync(
      BKW_MODE_RESTORE_PENDING_STATE_ID,
    );
    return state?.val === true || state?.val === 1 || state?.val === "1";
  }
}
exports.default = BkwModeService;
//# sourceMappingURL=bkwModeService.js.map
