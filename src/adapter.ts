import * as utils from '@iobroker/adapter-core';
import { networkInterfaces } from 'node:os';
import CommandService from './commands/commandService';
import { normalizeConfig } from './config';
import { ACTIVE_DEVICE_CLEANUP_INTERVAL_MS } from './constants';
import DeviceRegistry from './core/deviceRegistry';
import Scheduler from './core/scheduler';
import StateManager from './core/stateManager';
import BatteryModeService from './modes/batteryModeService';
import BkwModeService from './modes/bkwModeService';
import EcoModeService from './modes/ecoModeService';
import CloudApiPoller from './network/cloudApiPoller';
import LocalApiServer from './network/localApiServer';
import RequestClient from './network/requestClient';
import type { AdapterConfig, DeviceTouchEvent, RuntimeConfig, StateChange } from './types/shared';
import { extractRelativeId } from './utils/helpers';

export default class MaxxiChargeAdapter extends utils.Adapter {
    private runtimeConfig: RuntimeConfig | null = null;

    private scheduler: Scheduler | null = null;

    private stateManager: StateManager | null = null;

    private deviceRegistry: DeviceRegistry | null = null;

    private requestClient: RequestClient | null = null;

    private commandService: CommandService | null = null;

    private ecoMode: EcoModeService | null = null;

    private batteryMode: BatteryModeService | null = null;

    private bkwMode: BkwModeService | null = null;

    private localApi: LocalApiServer | null = null;

    private cloudApi: CloudApiPoller | null = null;

    private cleanupIntervalHandle: ioBroker.Interval = null;

    private disposePromise: Promise<void> | null = null;

    private shuttingDown = false;

    public constructor(options: Partial<utils.AdapterOptions> = {}) {
        super({
            ...options,
            name: 'maxxi-charge',
        });

        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('message', this.onMessage.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }

    private async onReady(): Promise<void> {
        try {
            this.runtimeConfig = normalizeConfig(this.config as AdapterConfig);
            this.scheduler = new Scheduler(this);
            this.stateManager = new StateManager(this);
            this.requestClient = new RequestClient(this);
            this.deviceRegistry = new DeviceRegistry(this, this.stateManager);
            this.commandService = new CommandService(this, this.stateManager, this.requestClient);
            this.ecoMode = new EcoModeService(
                this,
                this.runtimeConfig,
                this.scheduler,
                this.commandService,
                this.deviceRegistry,
            );
            this.batteryMode = new BatteryModeService(
                this,
                this.runtimeConfig,
                this.commandService,
                this.deviceRegistry,
            );
            this.bkwMode = new BkwModeService(
                this,
                this.runtimeConfig,
                this.commandService,
                this.deviceRegistry,
                this.stateManager,
            );

            await this.stateManager.ensureInfoStructure();
            await this.stateManager.resetInfoStates();

            if (this.runtimeConfig.apiMode === 'local') {
                this.localApi = new LocalApiServer(
                    this,
                    this.runtimeConfig,
                    this.stateManager,
                    this.deviceRegistry,
                    this.requestClient,
                    this.handleDeviceSeen.bind(this),
                );
                await this.localApi.start();
            } else {
                this.cloudApi = new CloudApiPoller(
                    this,
                    this.runtimeConfig,
                    this.scheduler,
                    this.stateManager,
                    this.deviceRegistry,
                    this.requestClient,
                    this.handleDeviceSeen.bind(this),
                );
                await this.cloudApi.start();
            }

            await this.ecoMode.start();
            await this.batteryMode.start();
            await this.bkwMode.start();

            this.cleanupIntervalHandle = this.scheduler.setInterval(
                async () => {
                    const cleanupResult = await this.deviceRegistry?.cleanupInactiveDevices();
                    for (const deviceId of cleanupResult?.removedDeviceIds ?? []) {
                        this.handleDeviceInactive(deviceId);
                    }
                    if (cleanupResult?.connectionLost) {
                        this.handleConnectionLost();
                    }
                },
                ACTIVE_DEVICE_CLEANUP_INTERVAL_MS,
                'active-device-cleanup',
            );
        } catch (error) {
            await this.failInitialization(error);
        }
    }

    private async onStateChange(id: string, state: StateChange): Promise<void> {
        if (!state || this.shuttingDown || !this.commandService) {
            return;
        }

        try {
            if (!state.ack) {
                const wasHandled = await this.commandService.handleStateChange(id, state);
                if (wasHandled) {
                    return;
                }
            }

            if (!state.ack || !this.isSocStateId(id)) {
                return;
            }

            await this.ecoMode?.handleSocChange(id, state);
            await this.batteryMode?.handleSocChange(id, state);
            await this.bkwMode?.handleSocChange(id, state);
        } catch (error) {
            this.log.error(
                `Error while processing state ${id}: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    private onMessage(obj: ioBroker.Message | undefined): void {
        if (!obj?.callback || obj.command !== 'getLocalApiRoute') {
            return;
        }

        const message = this.isRecord(obj.message) ? obj.message : {};
        const port = this.extractLocalApiPort(message.port);
        const preferredIp = typeof message.originIp === 'string' ? message.originIp.trim() : '';
        const localApiRoute = this.buildLocalApiRoute(preferredIp, port);

        this.sendTo(obj.from, obj.command, localApiRoute, obj.callback);
    }

    private async onUnload(callback: () => void): Promise<void> {
        this.shuttingDown = true;

        try {
            await this.dispose();
        } catch (error) {
            this.log.error(`Error during shutdown: ${error instanceof Error ? error.message : String(error)}`);
        }

        callback();
    }

    private handleConnectionLost(): void {
        this.ecoMode?.handleConnectionLost();
        this.batteryMode?.handleConnectionLost();
        this.bkwMode?.handleConnectionLost();
    }

    private handleDeviceInactive(deviceId: string): void {
        this.commandService?.handleDeviceInactive(deviceId);
        this.ecoMode?.handleDeviceInactive(deviceId);
        this.batteryMode?.handleDeviceInactive(deviceId);
        this.bkwMode?.handleDeviceInactive(deviceId);
    }

    private async handleDeviceSeen(deviceEvent: DeviceTouchEvent): Promise<void> {
        if (!deviceEvent.deviceId) {
            return;
        }

        if (deviceEvent.reconnectedAfterInactive) {
            this.log.info(`Device ${deviceEvent.deviceId} connected again.`);
        }

        if (!deviceEvent.isNewDevice && !deviceEvent.connectionBecameActive && !deviceEvent.reconnectedAfterInactive) {
            return;
        }

        try {
            await this.commandService?.syncDeviceCommandConfiguration(deviceEvent.deviceId);
            await this.ecoMode?.handleDeviceAvailable(deviceEvent.deviceId);
            await this.batteryMode?.handleDeviceAvailable(deviceEvent.deviceId);
            await this.bkwMode?.handleDeviceAvailable(deviceEvent.deviceId);
        } catch (error) {
            this.log.error(
                `Error while handling device activation for ${deviceEvent.deviceId}: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
        }
    }

    private isSocStateId(fullId: string): boolean {
        const relativeId = extractRelativeId(this.namespace, fullId);
        return Boolean(relativeId && relativeId.endsWith('.SOC'));
    }

    private buildLocalApiRoute(preferredIp: string, port: number): string {
        const ipAddress = this.getPreferredIpv4Address(preferredIp);
        return ipAddress
            ? `http://${ipAddress}:${port}`
            : `No local IPv4 address found for the ioBroker host (port ${port}).`;
    }

    private getPreferredIpv4Address(preferredIp: string): string | null {
        const ipv4Addresses = this.getLocalIpv4Addresses();
        if (preferredIp && ipv4Addresses.includes(preferredIp)) {
            return preferredIp;
        }

        return ipv4Addresses[0] ?? null;
    }

    private getLocalIpv4Addresses(): string[] {
        const interfaces = networkInterfaces();
        const ipv4Addresses = new Set<string>();

        for (const entries of Object.values(interfaces)) {
            for (const entry of entries ?? []) {
                if (entry.family !== 'IPv4' || entry.internal || !entry.address) {
                    continue;
                }

                ipv4Addresses.add(entry.address);
            }
        }

        return [...ipv4Addresses];
    }

    private extractLocalApiPort(value: unknown): number {
        const normalizedValue =
            typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? value : 5501;
        const numericPort = Number.parseInt(String(normalizedValue), 10);
        if (!Number.isFinite(numericPort)) {
            return 5501;
        }

        return Math.min(Math.max(numericPort, 1), 65_535);
    }

    private isRecord(value: unknown): value is Record<string, unknown> {
        return typeof value === 'object' && value !== null;
    }

    private async dispose(): Promise<void> {
        if (this.disposePromise) {
            await this.disposePromise;
            return;
        }

        this.disposePromise = this.performDispose();

        try {
            await this.disposePromise;
        } finally {
            this.disposePromise = null;
        }
    }

    private async performDispose(): Promise<void> {
        const disposals: Promise<void>[] = [];

        const scheduler = this.scheduler;
        const stateManager = this.stateManager;
        const deviceRegistry = this.deviceRegistry;
        const localApi = this.localApi;
        const cloudApi = this.cloudApi;
        const ecoMode = this.ecoMode;
        const batteryMode = this.batteryMode;
        const bkwMode = this.bkwMode;
        const commandService = this.commandService;

        if (this.cleanupIntervalHandle && scheduler) {
            scheduler.clearInterval(this.cleanupIntervalHandle);
            this.cleanupIntervalHandle = null;
        }

        this.localApi = null;
        this.cloudApi = null;
        this.ecoMode = null;
        this.batteryMode = null;
        this.bkwMode = null;
        this.commandService = null;
        this.scheduler = null;
        this.deviceRegistry = null;
        this.stateManager = null;
        this.requestClient = null;
        this.runtimeConfig = null;

        if (localApi) {
            disposals.push(localApi.dispose());
        }

        if (cloudApi) {
            disposals.push(cloudApi.dispose());
        }

        if (ecoMode) {
            disposals.push(ecoMode.dispose());
        }

        if (batteryMode) {
            disposals.push(batteryMode.dispose());
        }

        if (bkwMode) {
            disposals.push(bkwMode.dispose());
        }

        if (commandService) {
            disposals.push(commandService.dispose());
        }

        await Promise.allSettled(disposals);

        if (scheduler) {
            await scheduler.dispose();
        }

        if (deviceRegistry) {
            await deviceRegistry.reset();
        } else {
            await stateManager?.resetInfoStates();
        }

        stateManager?.clearCaches();
    }

    private async failInitialization(error: unknown): Promise<never> {
        this.shuttingDown = true;

        this.log.error(`Fatal error during initialization: ${error instanceof Error ? error.message : String(error)}`);

        try {
            await this.dispose();
        } catch (disposeError) {
            this.log.error(
                `Error during fatal initialization cleanup: ${
                    disposeError instanceof Error ? disposeError.message : String(disposeError)
                }`,
            );
        }

        this.terminate('Initialization failed', utils.EXIT_CODES.ADAPTER_REQUESTED_TERMINATION);
    }
}
