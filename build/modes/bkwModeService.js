"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const constants_1 = require("../constants");
const helpers_1 = require("../utils/helpers");
const BKW_MODE_RESTORE_PENDING_STATE_SUFFIX = "_bkwModeRestorePending";
class BkwModeService {
  adapter;
  config;
  commandService;
  deviceRegistry;
  stateManager;
  lastStateByDevice = new Map();
  initializedDeviceIds = new Set();
  maxSocForcedDeviceIds = new Set();
  constructor(adapter, config, commandService, deviceRegistry, stateManager) {
    this.adapter = adapter;
    this.config = config;
    this.commandService = commandService;
    this.deviceRegistry = deviceRegistry;
    this.stateManager = stateManager;
  }
  async start() {
    for (const deviceId of this.deviceRegistry.getActiveDeviceIds()) {
      await this.handleDeviceAvailable(deviceId);
    }
  }
  async handleDeviceAvailable(deviceId) {
    const normalizedDeviceId = deviceId.trim();
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
  handleConnectionLost() {
    this.lastStateByDevice.clear();
    this.initializedDeviceIds.clear();
    this.maxSocForcedDeviceIds.clear();
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
    const bkwPrepared = await this.ensureBkwOperatingMode(deviceId);
    if (!bkwPrepared) {
      return;
    }
    const lastState = this.lastStateByDevice.get(deviceId) ?? null;
    let nextState = null;
    let targetValue = null;
    if (state.val >= constants_1.BKW_SOC_THRESHOLD && lastState !== "high") {
      targetValue = -this.config.bkwPowerTarget;
      nextState = "high";
    } else if (
      state.val < constants_1.BKW_SOC_THRESHOLD &&
      lastState !== "low"
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
      if (nextState) {
        this.lastStateByDevice.set(deviceId, nextState);
      }
      await this.markRestorePending(deviceId);
      this.adapter.log.debug(
        `BkwMode: baseLoad set to ${targetValue} W for ${deviceId} (SOC=${state.val}%).`,
      );
    }
  }
  dispose() {
    this.lastStateByDevice.clear();
    this.initializedDeviceIds.clear();
    this.maxSocForcedDeviceIds.clear();
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
  async markRestorePending(deviceId) {
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
  async restoreConfiguredBaseLoad(deviceId, reason) {
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
  async readRestorePendingState(deviceId) {
    await this.ensureRestorePendingState(deviceId);
    const state = await this.adapter.getStateAsync(
      this.getRestorePendingStateId(deviceId),
    );
    return state?.val === true || state?.val === 1 || state?.val === "1";
  }
  async ensureRestorePendingState(deviceId) {
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
  getRestorePendingStateId(deviceId) {
    return `${deviceId}.${BKW_MODE_RESTORE_PENDING_STATE_SUFFIX}`;
  }
  async evaluateCurrentSoc(deviceId) {
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
  async ensureBkwOperatingMode(deviceId) {
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
exports.default = BkwModeService;
//# sourceMappingURL=bkwModeService.js.map
