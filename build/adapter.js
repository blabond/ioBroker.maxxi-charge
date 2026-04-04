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
    shuttingDown = false;
    constructor(options = {}) {
        super({
            ...options,
            name: "maxxi-charge",
        });
        this.on("ready", this.onReady.bind(this));
        this.on("stateChange", this.onStateChange.bind(this));
        this.on("unload", this.onUnload.bind(this));
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
            if (this.runtimeConfig.apiMode === "local") {
                this.localApi = new localApiServer_1.default(this, this.runtimeConfig, this.stateManager, this.deviceRegistry, this.commandService, this.requestClient, this.handleDeviceSeen.bind(this));
                await this.localApi.start();
            }
            else {
                this.cloudApi = new cloudApiPoller_1.default(this, this.runtimeConfig, this.scheduler, this.stateManager, this.deviceRegistry, this.commandService, this.requestClient, this.handleDeviceSeen.bind(this));
                await this.cloudApi.start();
            }
            await this.ecoMode.start();
            await this.batteryMode.start();
            await this.bkwMode.start();
            this.cleanupIntervalHandle = this.scheduler.setInterval(async () => {
                const cleanupResult = await this.deviceRegistry?.cleanupInactiveDevices();
                if (cleanupResult?.connectionLost) {
                    this.handleConnectionLost();
                }
            }, constants_1.ACTIVE_DEVICE_CLEANUP_INTERVAL_MS, "active-device-cleanup");
        }
        catch (error) {
            this.log.error(`Fatal error during initialization: ${error instanceof Error ? error.message : String(error)}`);
            await this.dispose();
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
    async handleDeviceSeen(deviceEvent) {
        if (!deviceEvent.deviceId) {
            return;
        }
        if (!deviceEvent.isNewDevice && !deviceEvent.connectionBecameActive) {
            return;
        }
        try {
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
        return Boolean(relativeId && relativeId.endsWith(".SOC"));
    }
    async dispose() {
        const disposals = [];
        if (this.cleanupIntervalHandle && this.scheduler) {
            this.scheduler.clearInterval(this.cleanupIntervalHandle);
            this.cleanupIntervalHandle = null;
        }
        if (this.localApi) {
            disposals.push(this.localApi.dispose());
            this.localApi = null;
        }
        if (this.cloudApi) {
            disposals.push(this.cloudApi.dispose());
            this.cloudApi = null;
        }
        if (this.ecoMode) {
            disposals.push(this.ecoMode.dispose());
        }
        if (this.batteryMode) {
            disposals.push(this.batteryMode.dispose());
        }
        if (this.bkwMode) {
            disposals.push(this.bkwMode.dispose());
        }
        if (this.commandService) {
            disposals.push(this.commandService.dispose());
        }
        await Promise.allSettled(disposals);
        if (this.scheduler) {
            await this.scheduler.dispose();
        }
        if (this.deviceRegistry) {
            await this.deviceRegistry.reset();
        }
        else {
            await this.stateManager?.resetInfoStates();
        }
        this.stateManager?.clearCaches();
    }
}
exports.default = MaxxiChargeAdapter;
//# sourceMappingURL=adapter.js.map