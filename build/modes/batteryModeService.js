"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const adapterConfigStore_1 = require("../utils/adapterConfigStore");
class BatteryModeService {
  adapter;
  config;
  commandService;
  deviceRegistry;
  calibrationAppliedForConnection = false;
  constructor(adapter, config, commandService, deviceRegistry) {
    this.adapter = adapter;
    this.config = config;
    this.commandService = commandService;
    this.deviceRegistry = deviceRegistry;
  }
  async start() {
    if (!this.config.batteryCalibrationEnabled) {
      return;
    }
    const activeDeviceId = this.deviceRegistry.getPrimaryDeviceId();
    if (activeDeviceId) {
      await this.handleDeviceAvailable(activeDeviceId);
    }
  }
  async handleDeviceAvailable(deviceId) {
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
  handleConnectionLost() {
    this.calibrationAppliedForConnection = false;
  }
  async handleSocChange(_id, state) {
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
  dispose() {
    this.calibrationAppliedForConnection = false;
    return Promise.resolve();
  }
  async applyCalibration(deviceId) {
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
        `BatteryMode: Calibration failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }
  async updateCalibrationState(enabled, progress) {
    try {
      await (0, adapterConfigStore_1.updateAdapterNativeConfig)(this.adapter, {
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
        `BatteryMode: Failed to update adapter config: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
exports.default = BatteryModeService;
//# sourceMappingURL=batteryModeService.js.map
