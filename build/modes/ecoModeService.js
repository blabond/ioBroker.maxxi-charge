"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const constants_1 = require("../constants");
const date_1 = require("../utils/date");
const helpers_1 = require("../utils/helpers");
class EcoModeService {
    adapter;
    config;
    scheduler;
    commandService;
    deviceRegistry;
    dailyJob = null;
    minSocSetTodayByDevice = new Map();
    started = false;
    constructor(adapter, config, scheduler, commandService, deviceRegistry) {
        this.adapter = adapter;
        this.config = config;
        this.scheduler = scheduler;
        this.commandService = commandService;
        this.deviceRegistry = deviceRegistry;
    }
    async start() {
        if (!this.config.seasonModeEnabled ||
            this.config.batteryCalibrationEnabled) {
            return;
        }
        if (!this.config.winterFrom || !this.config.winterTo) {
            this.adapter.log.warn("EcoMode: Winter dates are invalid. Season mode will stay inactive.");
            return;
        }
        if (this.started) {
            return;
        }
        this.dailyJob = this.scheduler.scheduleCron(`${this.adapter.namespace}-eco-evaluation`, "0 8 * * *", async () => {
            await this.evaluateActiveDevices();
        });
        this.started = true;
        await this.evaluateActiveDevices();
    }
    async handleDeviceAvailable(deviceId) {
        if (!this.started) {
            return;
        }
        const normalizedDeviceId = deviceId.trim();
        if (!normalizedDeviceId) {
            return;
        }
        await this.evaluateSeason(normalizedDeviceId);
    }
    handleDeviceInactive(deviceId) {
        const normalizedDeviceId = deviceId.trim();
        if (!normalizedDeviceId) {
            return;
        }
        this.minSocSetTodayByDevice.delete(normalizedDeviceId);
    }
    handleConnectionLost() {
        this.minSocSetTodayByDevice.clear();
    }
    async handleSocChange(id, state) {
        if (!this.started || !state?.ack || typeof state.val !== "number") {
            return;
        }
        const deviceId = this.extractDeviceId(id);
        if (!deviceId || this.minSocSetTodayByDevice.get(deviceId)) {
            return;
        }
        const todayValue = this.getTodayValue();
        const winterFromValue = (0, date_1.getDateValue)(this.config.winterFrom);
        const winterToValue = (0, date_1.getDateValue)(this.config.winterTo);
        const inWinterRange = (0, date_1.isInWrappedRange)(todayValue, winterFromValue, winterToValue);
        const isWinterEndDate = todayValue === winterToValue;
        if (!inWinterRange && !isWinterEndDate) {
            return;
        }
        if (state.val >= constants_1.ECO_SOC_TRIGGER_THRESHOLD) {
            const updated = await this.commandService.applyDeviceSetting(deviceId, "minSOC", constants_1.ECO_WINTER_RELAXED_MIN_SOC, { source: "ecoMode:socTrigger" });
            if (updated) {
                this.minSocSetTodayByDevice.set(deviceId, true);
            }
        }
    }
    dispose() {
        this.minSocSetTodayByDevice.clear();
        if (this.dailyJob) {
            this.scheduler.cancelJob(this.dailyJob);
            this.dailyJob = null;
        }
        this.started = false;
        return Promise.resolve();
    }
    async evaluateActiveDevices() {
        const activeDeviceIds = this.deviceRegistry.getActiveDeviceIds();
        if (activeDeviceIds.length === 0) {
            this.adapter.log.debug("EcoMode: No active device available for evaluation.");
            return;
        }
        for (const deviceId of activeDeviceIds) {
            await this.evaluateSeason(deviceId);
        }
    }
    async evaluateSeason(deviceId) {
        if (!deviceId) {
            return;
        }
        const todayValue = this.getTodayValue();
        const winterFromValue = (0, date_1.getDateValue)(this.config.winterFrom);
        const winterToValue = (0, date_1.getDateValue)(this.config.winterTo);
        if (todayValue === winterToValue) {
            const updated = await this.applySummerSettings(deviceId);
            if (updated) {
                this.minSocSetTodayByDevice.set(deviceId, true);
            }
            return;
        }
        if ((0, date_1.isInWrappedRange)(todayValue, winterFromValue, winterToValue)) {
            const minSocUpdated = await this.commandService.applyDeviceSetting(deviceId, "minSOC", constants_1.ECO_WINTER_MIN_SOC, { source: "ecoMode:winter" });
            const maxSocUpdated = await this.commandService.applyDeviceSetting(deviceId, "maxSOC", this.config.feedInMode, { source: "ecoMode:winter" });
            if (minSocUpdated && maxSocUpdated) {
                this.minSocSetTodayByDevice.set(deviceId, false);
            }
            return;
        }
        const updated = await this.applySummerSettings(deviceId);
        if (updated) {
            this.minSocSetTodayByDevice.set(deviceId, true);
        }
    }
    async applySummerSettings(deviceId) {
        const minSocUpdated = await this.commandService.applyDeviceSetting(deviceId, "minSOC", constants_1.ECO_SUMMER_MIN_SOC, { source: "ecoMode:summer" });
        const maxSocUpdated = await this.commandService.applyDeviceSetting(deviceId, "maxSOC", this.config.feedInMode, { source: "ecoMode:summer" });
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
        const relativeId = (0, helpers_1.extractRelativeId)(this.adapter.namespace, fullId);
        if (!relativeId) {
            return "";
        }
        return relativeId.split(".")[0] ?? "";
    }
}
exports.default = EcoModeService;
//# sourceMappingURL=ecoModeService.js.map