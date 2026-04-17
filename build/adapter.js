"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const utils = __importStar(require("@iobroker/adapter-core"));
const node_os_1 = require("node:os");
const commandService_1 = __importDefault(require("./commands/commandService"));
const config_1 = require("./config");
const constants_1 = require("./constants");
const deviceRegistry_1 = __importDefault(require("./core/deviceRegistry"));
const scheduler_1 = __importDefault(require("./core/scheduler"));
const stateManager_1 = __importDefault(require("./core/stateManager"));
const batteryModeService_1 = __importDefault(require("./modes/batteryModeService"));
const bkwModeService_1 = __importDefault(require("./modes/bkwModeService"));
const ecoModeService_1 = __importDefault(require("./modes/ecoModeService"));
const cloudApiPoller_1 = __importDefault(require("./network/cloudApiPoller"));
const localApiServer_1 = __importDefault(require("./network/localApiServer"));
const requestClient_1 = __importDefault(require("./network/requestClient"));
const helpers_1 = require("./utils/helpers");
class MaxxiChargeAdapter extends utils.Adapter {
    runtimeConfig = null;
    scheduler = null;
    stateManager = null;
    deviceRegistry = null;
    requestClient = null;
    commandService = null;
    ecoMode = null;
    batteryMode = null;
    bkwMode = null;
    localApi = null;
    cloudApi = null;
    cleanupIntervalHandle = null;
    disposePromise = null;
    shuttingDown = false;
    constructor(options = {}) {
        super({
            ...options,
            name: 'maxxi-charge',
        });
        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('message', this.onMessage.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }
    async onReady() {
        try {
            this.runtimeConfig = (0, config_1.normalizeConfig)(this.config);
            this.scheduler = new scheduler_1.default(this);
            this.stateManager = new stateManager_1.default(this);
            this.requestClient = new requestClient_1.default(this);
            this.deviceRegistry = new deviceRegistry_1.default(this, this.stateManager);
            this.commandService = new commandService_1.default(this, this.stateManager, this.requestClient);
            this.ecoMode = new ecoModeService_1.default(this, this.runtimeConfig, this.scheduler, this.commandService, this.deviceRegistry);
            this.batteryMode = new batteryModeService_1.default(this, this.runtimeConfig, this.commandService, this.deviceRegistry);
            this.bkwMode = new bkwModeService_1.default(this, this.runtimeConfig, this.commandService, this.deviceRegistry, this.stateManager);
            await this.stateManager.ensureInfoStructure();
            await this.stateManager.resetInfoStates();
            if (this.runtimeConfig.apiMode === 'local') {
                this.localApi = new localApiServer_1.default(this, this.runtimeConfig, this.stateManager, this.deviceRegistry, this.requestClient, this.handleDeviceSeen.bind(this));
                await this.localApi.start();
            }
            else {
                this.cloudApi = new cloudApiPoller_1.default(this, this.runtimeConfig, this.scheduler, this.stateManager, this.deviceRegistry, this.requestClient, this.handleDeviceSeen.bind(this));
                await this.cloudApi.start();
            }
            await this.ecoMode.start();
            await this.batteryMode.start();
            await this.bkwMode.start();
            this.cleanupIntervalHandle = this.scheduler.setInterval(async () => {
                const cleanupResult = await this.deviceRegistry?.cleanupInactiveDevices();
                for (const deviceId of cleanupResult?.removedDeviceIds ?? []) {
                    this.handleDeviceInactive(deviceId);
                }
                if (cleanupResult?.connectionLost) {
                    this.handleConnectionLost();
                }
            }, constants_1.ACTIVE_DEVICE_CLEANUP_INTERVAL_MS, 'active-device-cleanup');
        }
        catch (error) {
            await this.failInitialization(error);
        }
    }
    async onStateChange(id, state) {
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
        }
        catch (error) {
            this.log.error(`Error while processing state ${id}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    onMessage(obj) {
        if (!obj?.callback || obj.command !== 'getLocalApiRoute') {
            return;
        }
        const message = this.isRecord(obj.message) ? obj.message : {};
        const port = this.extractLocalApiPort(message.port);
        const preferredIp = typeof message.originIp === 'string' ? message.originIp.trim() : '';
        const localApiRoute = this.buildLocalApiRoute(preferredIp, port);
        this.sendTo(obj.from, obj.command, localApiRoute, obj.callback);
    }
    async onUnload(callback) {
        this.shuttingDown = true;
        try {
            await this.dispose();
        }
        catch (error) {
            this.log.error(`Error during shutdown: ${error instanceof Error ? error.message : String(error)}`);
        }
        callback();
    }
    handleConnectionLost() {
        this.ecoMode?.handleConnectionLost();
        this.batteryMode?.handleConnectionLost();
        this.bkwMode?.handleConnectionLost();
    }
    handleDeviceInactive(deviceId) {
        this.commandService?.handleDeviceInactive(deviceId);
        this.ecoMode?.handleDeviceInactive(deviceId);
        this.batteryMode?.handleDeviceInactive(deviceId);
        this.bkwMode?.handleDeviceInactive(deviceId);
    }
    async handleDeviceSeen(deviceEvent) {
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
        }
        catch (error) {
            this.log.error(`Error while handling device activation for ${deviceEvent.deviceId}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    isSocStateId(fullId) {
        const relativeId = (0, helpers_1.extractRelativeId)(this.namespace, fullId);
        return Boolean(relativeId && relativeId.endsWith('.SOC'));
    }
    buildLocalApiRoute(preferredIp, port) {
        const ipAddress = this.getPreferredIpv4Address(preferredIp);
        return ipAddress
            ? `http://${ipAddress}:${port}`
            : `No local IPv4 address found for the ioBroker host (port ${port}).`;
    }
    getPreferredIpv4Address(preferredIp) {
        const ipv4Addresses = this.getLocalIpv4Addresses();
        if (preferredIp && ipv4Addresses.includes(preferredIp)) {
            return preferredIp;
        }
        return ipv4Addresses[0] ?? null;
    }
    getLocalIpv4Addresses() {
        const interfaces = (0, node_os_1.networkInterfaces)();
        const ipv4Addresses = new Set();
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
    extractLocalApiPort(value) {
        const normalizedValue = typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? value : 5501;
        const numericPort = Number.parseInt(String(normalizedValue), 10);
        if (!Number.isFinite(numericPort)) {
            return 5501;
        }
        return Math.min(Math.max(numericPort, 1), 65_535);
    }
    isRecord(value) {
        return typeof value === 'object' && value !== null;
    }
    async dispose() {
        if (this.disposePromise) {
            await this.disposePromise;
            return;
        }
        this.disposePromise = this.performDispose();
        try {
            await this.disposePromise;
        }
        finally {
            this.disposePromise = null;
        }
    }
    async performDispose() {
        const disposals = [];
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
        }
        else {
            await stateManager?.resetInfoStates();
        }
        stateManager?.clearCaches();
    }
    async failInitialization(error) {
        this.shuttingDown = true;
        this.log.error(`Fatal error during initialization: ${error instanceof Error ? error.message : String(error)}`);
        try {
            await this.dispose();
        }
        catch (disposeError) {
            this.log.error(`Error during fatal initialization cleanup: ${disposeError instanceof Error ? disposeError.message : String(disposeError)}`);
        }
        this.terminate('Initialization failed', utils.EXIT_CODES.ADAPTER_REQUESTED_TERMINATION);
    }
}
exports.default = MaxxiChargeAdapter;
//# sourceMappingURL=adapter.js.map