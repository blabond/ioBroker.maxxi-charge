"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const date_1 = require("../utils/date");
const helpers_1 = require("../utils/helpers");
class EcoModeService {
  adapter;
  config;
  scheduler;
  commandService;
  deviceRegistry;
  dailyJob = null;
  minSocSetToday = false;
  started = false;
  constructor(adapter, config, scheduler, commandService, deviceRegistry) {
    this.adapter = adapter;
    this.config = config;
    this.scheduler = scheduler;
    this.commandService = commandService;
    this.deviceRegistry = deviceRegistry;
  }
  async start() {
    if (
      !this.config.seasonModeEnabled ||
      this.config.batteryCalibrationEnabled
    ) {
      return;
    }
    if (!this.config.winterFrom || !this.config.winterTo) {
      this.adapter.log.warn(
        "EcoMode: Winter dates are invalid. Season mode will stay inactive.",
      );
      return;
    }
    if (this.started) {
      return;
    }
    this.dailyJob = this.scheduler.scheduleCron(
      `${this.adapter.namespace}-eco-evaluation`,
      "0 8 * * *",
      async () => {
        await this.evaluateSeason();
      },
    );
    this.started = true;
    const activeDeviceId = this.deviceRegistry.getPrimaryDeviceId();
    if (activeDeviceId) {
      await this.evaluateSeason(activeDeviceId);
    }
  }
  async handleDeviceAvailable(deviceId) {
    if (!this.started) {
      return;
    }
    await this.evaluateSeason(deviceId);
  }
  handleConnectionLost() {
    this.minSocSetToday = false;
  }
  async handleSocChange(id, state) {
    if (
      !this.started ||
      !state?.ack ||
      typeof state.val !== "number" ||
      this.minSocSetToday
    ) {
      return;
    }
    const deviceId = this.extractDeviceId(id);
    if (!deviceId) {
      return;
    }
    const todayValue = this.getTodayValue();
    const winterFromValue = (0, date_1.getDateValue)(this.config.winterFrom);
    const winterToValue = (0, date_1.getDateValue)(this.config.winterTo);
    const inWinterRange = (0, date_1.isInWrappedRange)(
      todayValue,
      winterFromValue,
      winterToValue,
    );
    const isWinterEndDate = todayValue === winterToValue;
    if (!inWinterRange && !isWinterEndDate) {
      return;
    }
    if (state.val >= 55) {
      const updated = await this.commandService.applyDeviceSetting(
        deviceId,
        "minSOC",
        40,
        { source: "ecoMode:socTrigger" },
      );
      if (updated) {
        this.minSocSetToday = true;
      }
    }
  }
  dispose() {
    this.minSocSetToday = false;
    if (this.dailyJob) {
      this.scheduler.cancelJob(this.dailyJob);
      this.dailyJob = null;
    }
    this.started = false;
    return Promise.resolve();
  }
  async evaluateSeason(preferredDeviceId) {
    const deviceId =
      preferredDeviceId ?? this.deviceRegistry.getPrimaryDeviceId();
    if (!deviceId) {
      this.adapter.log.debug(
        "EcoMode: No active device available for evaluation.",
      );
      return;
    }
    const todayValue = this.getTodayValue();
    const winterFromValue = (0, date_1.getDateValue)(this.config.winterFrom);
    const winterToValue = (0, date_1.getDateValue)(this.config.winterTo);
    if (todayValue === winterToValue) {
      const updated = await this.applySummerSettings(deviceId);
      if (updated) {
        this.minSocSetToday = true;
      }
      return;
    }
    if (
      (0, date_1.isInWrappedRange)(todayValue, winterFromValue, winterToValue)
    ) {
      const minSocUpdated = await this.commandService.applyDeviceSetting(
        deviceId,
        "minSOC",
        60,
        { source: "ecoMode:winter" },
      );
      const maxSocUpdated = await this.commandService.applyDeviceSetting(
        deviceId,
        "maxSOC",
        this.config.feedInMode,
        { source: "ecoMode:winter" },
      );
      if (minSocUpdated && maxSocUpdated) {
        this.minSocSetToday = false;
      }
      return;
    }
    const updated = await this.applySummerSettings(deviceId);
    if (updated) {
      this.minSocSetToday = true;
    }
  }
  async applySummerSettings(deviceId) {
    const minSocUpdated = await this.commandService.applyDeviceSetting(
      deviceId,
      "minSOC",
      10,
      { source: "ecoMode:summer" },
    );
    const maxSocUpdated = await this.commandService.applyDeviceSetting(
      deviceId,
      "maxSOC",
      this.config.feedInMode,
      { source: "ecoMode:summer" },
    );
    return minSocUpdated && maxSocUpdated;
  }
  getTodayValue() {
    const now = new Date();
    return (0, date_1.getDateValue)({
      day: now.getDate(),
      month: now.getMonth() + 1,
    });
  }
  extractDeviceId(fullId) {
    const relativeId = (0, helpers_1.extractRelativeId)(
      this.adapter.namespace,
      fullId,
    );
    if (!relativeId) {
      return "";
    }
    return relativeId.split(".")[0] ?? "";
  }
}
exports.default = EcoModeService;
//# sourceMappingURL=ecoModeService.js.map
