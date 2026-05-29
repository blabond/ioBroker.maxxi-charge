"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const constants_1 = require("../constants");
const adapterConfigStore_1 = require("../utils/adapterConfigStore");
const helpers_1 = require("../utils/helpers");
class BatteryModeService {
    adapter;
    config;
    commandService;
    deviceRegistry;
    calibrationAppliedDeviceIds = new Set();
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
        await this.applyCalibrationToDevices(this.deviceRegistry.getActiveDeviceIds());
    }
    async handleDeviceAvailable(deviceId) {
        const normalizedDeviceId = deviceId.trim();
        if (!normalizedDeviceId ||
            !this.config.batteryCalibrationEnabled ||
            this.calibrationAppliedDeviceIds.has(normalizedDeviceId)) {
            return;
        }
        const applied = await this.applyCalibration(normalizedDeviceId);
        if (applied) {
            this.calibrationAppliedDeviceIds.add(normalizedDeviceId);
        }
    }
    handleDeviceInactive(deviceId) {
        const normalizedDeviceId = deviceId.trim();
        if (!normalizedDeviceId) {
            return;
        }
        this.calibrationAppliedDeviceIds.delete(normalizedDeviceId);
    }
    handleConnectionLost() {
        this.calibrationAppliedDeviceIds.clear();
    }
    async handleSocChange(id, state) {
        if (!this.config.batteryCalibrationEnabled || !state?.ack || typeof state.val !== 'number') {
            return;
        }
        const deviceId = this.extractDeviceId(id);
        if (!deviceId) {
            return;
        }
        if (this.config.calibrationProgress === 'down' && state.val <= constants_1.BATTERY_CALIBRATION_EMPTY_SOC) {
            const changed = await this.updateCalibrationState(true, 'up');
            if (changed) {
                this.calibrationAppliedDeviceIds.clear();
                await this.applyCalibrationToDevices(this.deviceRegistry.getActiveDeviceIds());
            }
            return;
        }
        if (this.config.calibrationProgress === 'up' && state.val >= constants_1.BATTERY_CALIBRATION_FULL_SOC) {
            const changed = await this.updateCalibrationState(false, 'down');
            if (changed) {
                this.calibrationAppliedDeviceIds.clear();
                this.calibrationAppliedDeviceIds.delete(deviceId);
            }
        }
    }
    dispose() {
        this.calibrationAppliedDeviceIds.clear();
        return Promise.resolve();
    }
    async applyCalibrationToDevices(deviceIds) {
        for (const deviceId of deviceIds) {
            await this.handleDeviceAvailable(deviceId);
        }
    }
    extractDeviceId(fullId) {
        const relativeId = (0, helpers_1.extractRelativeId)(this.adapter.namespace, fullId);
        if (!relativeId) {
            return '';
        }
        return relativeId.split('.')[0] ?? '';
    }
    async applyCalibration(deviceId) {
        try {
            if (this.config.calibrationProgress === 'down') {
                const minSocUpdated = await this.commandService.applyDeviceSetting(deviceId, 'minSOC', 0, {
                    source: 'batteryMode:down',
                });
                const maxSocUpdated = await this.commandService.applyDeviceSetting(deviceId, 'maxSOC', 100, {
                    source: 'batteryMode:down',
                });
                return minSocUpdated && maxSocUpdated;
            }
            if (this.config.calibrationProgress === 'up') {
                const minSocUpdated = await this.commandService.applyDeviceSetting(deviceId, 'minSOC', 99, {
                    source: 'batteryMode:up',
                });
                const maxSocUpdated = await this.commandService.applyDeviceSetting(deviceId, 'maxSOC', 100, {
                    source: 'batteryMode:up',
                });
                return minSocUpdated && maxSocUpdated;
            }
            return false;
        }
        catch (error) {
            this.adapter.log.error(`BatteryMode: Calibration failed: ${error instanceof Error ? error.message : String(error)}`);
            return false;
        }
    }
    async updateCalibrationState(enabled, progress) {
        if (this.config.batteryCalibrationEnabled === enabled && this.config.calibrationProgress === progress) {
            return false;
        }
        try {
            await (0, adapterConfigStore_1.updateAdapterNativeConfig)(this.adapter, {
                batterycalibration: enabled,
                calibrationProgress: progress,
            });
            this.config.batteryCalibrationEnabled = enabled;
            this.config.calibrationProgress = progress;
            if (!enabled) {
                this.calibrationAppliedDeviceIds.clear();
            }
            this.adapter.log.debug(`BatteryMode: Updated calibration state to enabled=${enabled}, progress=${progress}.`);
            return true;
        }
        catch (error) {
            this.adapter.log.error(`BatteryMode: Failed to update adapter config: ${error instanceof Error ? error.message : String(error)}`);
            return false;
        }
    }
}
exports.default = BatteryModeService;
//# sourceMappingURL=batteryModeService.js.map