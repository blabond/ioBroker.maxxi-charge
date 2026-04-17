"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const constants_1 = require("../constants");
const helpers_1 = require("../utils/helpers");
class DeviceRegistry {
    adapter;
    stateManager;
    inactiveAfterMs;
    activeDevices = new Map();
    inactiveDevices = new Set();
    subscribedSocStates = new Set();
    constructor(adapter, stateManager, inactiveAfterMs = constants_1.ACTIVE_DEVICE_TTL_MS) {
        this.adapter = adapter;
        this.stateManager = stateManager;
        this.inactiveAfterMs = inactiveAfterMs;
    }
    getActiveDeviceIds() {
        return [...this.activeDevices.keys()];
    }
    getPrimaryDeviceId() {
        return this.getActiveDeviceIds()[0] ?? null;
    }
    async touch(deviceId) {
        const normalizedDeviceId = (0, helpers_1.normalizeDeviceId)(deviceId);
        if (!normalizedDeviceId) {
            return {
                deviceId: '',
                isNewDevice: false,
                connectionBecameActive: false,
                reconnectedAfterInactive: false,
            };
        }
        const wasConnected = this.activeDevices.size > 0;
        const isNewDevice = !this.activeDevices.has(normalizedDeviceId);
        const reconnectedAfterInactive = this.inactiveDevices.delete(normalizedDeviceId);
        this.activeDevices.set(normalizedDeviceId, Date.now());
        if (isNewDevice) {
            this.subscribeSocState(normalizedDeviceId);
        }
        await this.stateManager.setInfoStates(this.getActiveDeviceIds());
        return {
            deviceId: normalizedDeviceId,
            isNewDevice,
            connectionBecameActive: !wasConnected && this.activeDevices.size > 0,
            reconnectedAfterInactive,
        };
    }
    async cleanupInactiveDevices() {
        const staleBefore = Date.now() - this.inactiveAfterMs;
        const removedDeviceIds = [];
        const wasConnected = this.activeDevices.size > 0;
        for (const [deviceId, lastSeen] of this.activeDevices.entries()) {
            if (lastSeen >= staleBefore) {
                continue;
            }
            this.activeDevices.delete(deviceId);
            removedDeviceIds.push(deviceId);
            this.inactiveDevices.add(deviceId);
            this.unsubscribeSocState(deviceId);
            this.adapter.log.warn(`Device ${deviceId} marked as inactive and removed.`);
        }
        if (removedDeviceIds.length > 0) {
            await this.stateManager.setInfoStates(this.getActiveDeviceIds());
        }
        return {
            removedDeviceIds,
            connectionLost: wasConnected && this.activeDevices.size === 0,
        };
    }
    async reset() {
        for (const deviceId of this.activeDevices.keys()) {
            this.unsubscribeSocState(deviceId);
        }
        this.activeDevices.clear();
        this.inactiveDevices.clear();
        await this.stateManager.resetInfoStates();
    }
    subscribeSocState(deviceId) {
        const relativeId = `${deviceId}.SOC`;
        if (this.subscribedSocStates.has(relativeId)) {
            return;
        }
        this.adapter.subscribeStates(relativeId);
        this.subscribedSocStates.add(relativeId);
        this.adapter.log.debug(`Subscribed to dynamic state ${relativeId}.`);
    }
    unsubscribeSocState(deviceId) {
        const relativeId = `${deviceId}.SOC`;
        if (!this.subscribedSocStates.has(relativeId)) {
            return;
        }
        this.adapter.unsubscribeStates(relativeId);
        this.subscribedSocStates.delete(relativeId);
        this.adapter.log.debug(`Unsubscribed from dynamic state ${relativeId}.`);
    }
}
exports.default = DeviceRegistry;
//# sourceMappingURL=deviceRegistry.js.map