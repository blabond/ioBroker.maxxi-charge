"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const constants_1 = require("../constants");
const helpers_1 = require("../utils/helpers");
class BkwModeService {
  adapter;
  config;
  commandService;
  deviceRegistry;
  lastState = null;
  constructor(adapter, config, commandService, deviceRegistry) {
    this.adapter = adapter;
    this.config = config;
    this.commandService = commandService;
    this.deviceRegistry = deviceRegistry;
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
      this.adapter.log.debug(
        `BkwMode: baseLoad set to ${targetValue} W for ${deviceId} (SOC=${state.val}%).`,
      );
    }
  }
  dispose() {
    this.lastState = null;
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
}
exports.default = BkwModeService;
//# sourceMappingURL=bkwModeService.js.map
