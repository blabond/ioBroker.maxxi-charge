import { ACTIVE_DEVICE_TTL_MS } from '../constants';
import type { AdapterInstance, DeviceTouchEvent } from '../types/shared';
import { normalizeDeviceId } from '../utils/helpers';
import type StateManager from './stateManager';

export default class DeviceRegistry {
    private readonly activeDevices = new Map<string, number>();

    private readonly inactiveDevices = new Set<string>();

    private readonly subscribedSocStates = new Set<string>();

    public constructor(
        private readonly adapter: AdapterInstance,
        private readonly stateManager: StateManager,
        private readonly inactiveAfterMs = ACTIVE_DEVICE_TTL_MS,
    ) {}

    public getActiveDeviceIds(): string[] {
        return [...this.activeDevices.keys()];
    }

    public getPrimaryDeviceId(): string | null {
        return this.getActiveDeviceIds()[0] ?? null;
    }

    public async touch(deviceId: string): Promise<DeviceTouchEvent> {
        const normalizedDeviceId = normalizeDeviceId(deviceId);
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

    public async cleanupInactiveDevices(): Promise<{
        removedDeviceIds: string[];
        connectionLost: boolean;
    }> {
        const staleBefore = Date.now() - this.inactiveAfterMs;
        const removedDeviceIds: string[] = [];
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

    public async reset(): Promise<void> {
        for (const deviceId of this.activeDevices.keys()) {
            this.unsubscribeSocState(deviceId);
        }

        this.activeDevices.clear();
        this.inactiveDevices.clear();
        await this.stateManager.resetInfoStates();
    }

    private subscribeSocState(deviceId: string): void {
        const relativeId = `${deviceId}.SOC`;
        if (this.subscribedSocStates.has(relativeId)) {
            return;
        }

        this.adapter.subscribeStates(relativeId);
        this.subscribedSocStates.add(relativeId);
        this.adapter.log.debug(`Subscribed to dynamic state ${relativeId}.`);
    }

    private unsubscribeSocState(deviceId: string): void {
        const relativeId = `${deviceId}.SOC`;
        if (!this.subscribedSocStates.has(relativeId)) {
            return;
        }

        this.adapter.unsubscribeStates(relativeId);
        this.subscribedSocStates.delete(relativeId);
        this.adapter.log.debug(`Unsubscribed from dynamic state ${relativeId}.`);
    }
}
