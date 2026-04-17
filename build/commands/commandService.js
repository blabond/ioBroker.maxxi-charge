'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
const constants_1 = require('../constants');
const helpers_1 = require('../utils/helpers');
const SENDCOMMAND_INITIALIZED_STATE_SUFFIX = '_sendcommandInitialized';
const SENDCOMMAND_INITIALIZED_CODE = '260410';
const COMMAND_DEFINITIONS = [
    {
        id: 'maxOutputPower',
        name: {
            en: 'Micro-inverter maximum power (W)',
            de: 'Mikrowechselrichter maximale Leistung (W)',
        },
        type: 'number',
        role: 'level',
        min: 300,
        max: 2300,
        unit: 'W',
    },
    {
        id: 'offlinePower',
        name: {
            en: 'Offline output power (W)',
            de: 'Offline-Ausgangsleistung (W)',
        },
        type: 'number',
        role: 'level',
        min: 50,
        max: 600,
        unit: 'W',
    },
    {
        id: 'baseLoad',
        name: {
            en: 'Adjust output (W)',
            de: 'Ausgabe anpassen (W)',
        },
        type: 'number',
        role: 'level',
        min: -1000,
        max: 600,
        unit: 'W',
    },
    {
        id: 'offlineMode',
        name: {
            en: 'Cloudservice',
            de: 'Cloudservice',
        },
        type: 'number',
        role: 'value',
        min: 1,
        max: 2,
        states: {
            1: 'Cloud mode aktiv',
            2: 'Lokal mode aktiv',
        },
    },
    {
        id: 'threshold',
        name: {
            en: 'Response tolerance (W)',
            de: 'Reaktionstoleranz (W)',
        },
        type: 'number',
        role: 'level',
        min: 3,
        max: 50,
        unit: 'W',
    },
    {
        id: 'minSOC',
        name: {
            en: 'Minimum battery discharge',
            de: 'Minimale Batterieentladung',
        },
        type: 'number',
        role: 'level.min',
        min: 0,
        max: 99,
        unit: '%',
    },
    {
        id: 'maxSOC',
        name: {
            en: 'Maximum battery discharge',
            de: 'Maximale Batterieentladung',
        },
        type: 'number',
        role: 'level.max',
        min: 20,
        max: 100,
        unit: '%',
    },
];
class CommandService {
    adapter;
    stateManager;
    requestClient;
    commandDefinitions = new Map(COMMAND_DEFINITIONS.map(definition => [definition.id, definition]));
    confirmedCommandValueCache = new Map();
    subscribedStateIds = new Set();
    constructor(adapter, stateManager, requestClient) {
        this.adapter = adapter;
        this.stateManager = stateManager;
        this.requestClient = requestClient;
    }
    async ensureDeviceStates(deviceId) {
        const normalizedDeviceId = (0, helpers_1.normalizeDeviceId)(deviceId);
        if (!normalizedDeviceId) {
            return;
        }
        await this.stateManager.ensureDevice(normalizedDeviceId);
        await this.stateManager.ensureChannel(`${normalizedDeviceId}.sendcommand`, {
            name: 'sendcommand',
        });
        for (const definition of this.commandDefinitions.values()) {
            const relativeId = `${normalizedDeviceId}.sendcommand.${definition.id}`;
            const stateCommon = {
                name: definition.name,
                type: definition.type,
                role: definition.role,
                read: true,
                write: true,
                ...(typeof definition.min === 'number' ? { min: definition.min } : {}),
                ...(typeof definition.max === 'number' ? { max: definition.max } : {}),
                ...(typeof definition.unit === 'string' ? { unit: definition.unit } : {}),
                ...(definition.states ? { states: definition.states } : {}),
            };
            await this.stateManager.ensureStateObject(relativeId, stateCommon);
            if (!this.subscribedStateIds.has(relativeId)) {
                this.adapter.subscribeStates(relativeId);
                this.subscribedStateIds.add(relativeId);
            }
        }
    }
    async syncDeviceCommandConfiguration(deviceId) {
        const normalizedDeviceId = (0, helpers_1.normalizeDeviceId)(deviceId);
        if (!normalizedDeviceId) {
            return;
        }
        await this.stateManager.ensureDevice(normalizedDeviceId);
        await this.ensureSendcommandInitializedState(normalizedDeviceId);
        const stateId = this.getSendcommandInitializedStateId(normalizedDeviceId);
        const currentState = await this.adapter.getStateAsync(stateId);
        const currentCode =
            currentState?.val === null || typeof currentState?.val === 'undefined' ? '' : String(currentState.val);
        if (currentCode !== SENDCOMMAND_INITIALIZED_CODE) {
            await this.resetSendcommandFolder(normalizedDeviceId);
            await this.adapter.setStateAsync(stateId, {
                val: SENDCOMMAND_INITIALIZED_CODE,
                ack: true,
            });
        }
        await this.ensureDeviceStates(normalizedDeviceId);
    }
    async handleStateChange(id, state) {
        if (!state || state.ack) {
            return false;
        }
        const parsedState = this.parseCommandStateId(id);
        if (!parsedState) {
            return false;
        }
        await this.applyDeviceSetting(parsedState.deviceId, parsedState.commandId, state.val, {
            source: 'stateChange',
        });
        return true;
    }
    async applyDeviceSetting(deviceId, commandId, rawValue, _options = {}) {
        const normalizedDeviceId = (0, helpers_1.normalizeDeviceId)(deviceId);
        const definition = this.commandDefinitions.get(commandId);
        if (!normalizedDeviceId || !definition) {
            this.adapter.log.debug(`CommandService: Unsupported command ${commandId} for device ${deviceId}.`);
            return false;
        }
        const normalizedValue = this.normalizeValue(definition, rawValue);
        if (normalizedValue === null) {
            this.adapter.log.debug(`CommandService: Invalid value ${JSON.stringify(rawValue)} for ${commandId}.`);
            return false;
        }
        await this.ensureDeviceStates(normalizedDeviceId);
        const stateId = this.getCommandStateId(normalizedDeviceId, commandId);
        if (await this.hasConfirmedCommandValue(stateId, normalizedDeviceId, commandId, normalizedValue)) {
            this.adapter.log.debug(
                `CommandService: Skipping ${commandId}=${normalizedValue} for ${normalizedDeviceId} because the value is already confirmed.`,
            );
            await this.stateManager.setStateIfChanged(stateId, normalizedValue, true);
            return true;
        }
        const ipAddress = await this.resolveDeviceIp(normalizedDeviceId);
        if (!ipAddress) {
            this.adapter.log.debug(`CommandService: No IP address found for device ${normalizedDeviceId}.`);
            return false;
        }
        const sendSucceeded = await this.sendCommandWithRetry(
            ipAddress,
            commandId,
            normalizedValue,
            normalizedDeviceId,
        );
        if (!sendSucceeded) {
            return false;
        }
        this.confirmedCommandValueCache.set(
            this.getConfirmedCommandValueCacheKey(normalizedDeviceId, commandId),
            normalizedValue,
        );
        await this.stateManager.setStateIfChanged(stateId, normalizedValue, true);
        return true;
    }
    dispose() {
        for (const relativeId of this.subscribedStateIds) {
            this.adapter.unsubscribeStates(relativeId);
        }
        this.subscribedStateIds.clear();
        this.confirmedCommandValueCache.clear();
        return Promise.resolve();
    }
    handleDeviceInactive(deviceId) {
        const normalizedDeviceId = (0, helpers_1.normalizeDeviceId)(deviceId);
        if (!normalizedDeviceId) {
            return;
        }
        const relativeIdPrefix = `${normalizedDeviceId}.sendcommand.`;
        for (const relativeId of [...this.subscribedStateIds]) {
            if (!relativeId.startsWith(relativeIdPrefix)) {
                continue;
            }
            this.adapter.unsubscribeStates(relativeId);
            this.subscribedStateIds.delete(relativeId);
        }
        for (const commandId of this.commandDefinitions.keys()) {
            this.confirmedCommandValueCache.delete(
                this.getConfirmedCommandValueCacheKey(normalizedDeviceId, commandId),
            );
        }
    }
    async ensureSendcommandInitializedState(deviceId) {
        const stateId = this.getSendcommandInitializedStateId(deviceId);
        await this.stateManager.ensureStateObject(stateId, {
            name: {
                en: 'Sendcommand configuration initialized',
                de: 'Sendcommand-Konfiguration initialisiert',
            },
            type: 'string',
            role: 'text',
            read: true,
            write: false,
            expert: true,
            hidden: true,
            def: '',
        });
    }
    getSendcommandInitializedStateId(deviceId) {
        return `${deviceId}.${SENDCOMMAND_INITIALIZED_STATE_SUFFIX}`;
    }
    async resetSendcommandFolder(deviceId) {
        const channelId = `${deviceId}.sendcommand`;
        const channelObject = await this.adapter.getObjectAsync(channelId);
        if (!channelObject) {
            return;
        }
        for (const relativeId of [...this.subscribedStateIds]) {
            if (!relativeId.startsWith(`${channelId}.`)) {
                continue;
            }
            this.adapter.unsubscribeStates(relativeId);
            this.subscribedStateIds.delete(relativeId);
        }
        for (const commandId of this.commandDefinitions.keys()) {
            this.confirmedCommandValueCache.delete(this.getConfirmedCommandValueCacheKey(deviceId, commandId));
        }
        await this.adapter.delObjectAsync(channelId, { recursive: true });
    }
    async sendCommandWithRetry(ipAddress, commandId, value, deviceId) {
        const url = `http://${ipAddress}/config`;
        const payload = new URLSearchParams({
            [commandId]: String(value),
        }).toString();
        for (let attempt = 1; attempt <= constants_1.COMMAND_RETRY_COUNT + 1; attempt++) {
            try {
                this.adapter.log.debug(
                    `CommandService: Sending ${commandId}=${value} to ${deviceId} via ${url} (attempt ${attempt}/${constants_1.COMMAND_RETRY_COUNT + 1}).`,
                );
                const response = await this.requestClient.post(url, payload, {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                    },
                    timeoutMs: constants_1.COMMAND_REQUEST_TIMEOUT_MS,
                    label: `Command ${commandId} for ${deviceId}`,
                    responseType: 'text',
                    transport: 'node',
                });
                this.adapter.log.debug(
                    `CommandService: Sent ${commandId}=${value} to ${deviceId} (status=${response.status}).`,
                );
                return true;
            } catch (error) {
                if (attempt <= constants_1.COMMAND_RETRY_COUNT) {
                    this.adapter.log.warn(
                        `CommandService: Retry ${attempt}/${constants_1.COMMAND_RETRY_COUNT} for ${commandId} on ${deviceId}.`,
                    );
                    await (0, helpers_1.sleep)(constants_1.COMMAND_RETRY_DELAY_MS);
                    continue;
                }
                this.adapter.log.error(
                    `CommandService: Failed to send ${commandId}=${value} to ${deviceId}: ${error instanceof Error ? error.message : String(error)}`,
                );
                return false;
            }
        }
        return false;
    }
    normalizeValue(definition, rawValue) {
        if (definition.type !== 'number') {
            return null;
        }
        const numericValue = Number(rawValue);
        if (!Number.isFinite(numericValue)) {
            return null;
        }
        const roundedValue = Math.round(numericValue);
        const clampedValue = (0, helpers_1.clampNumber)(roundedValue, definition.min, definition.max);
        if (clampedValue !== roundedValue) {
            this.adapter.log.warn(`CommandService: Clamped ${definition.id} from ${roundedValue} to ${clampedValue}.`);
        }
        return clampedValue;
    }
    parseCommandStateId(fullId) {
        const relativeId = (0, helpers_1.extractRelativeId)(this.adapter.namespace, fullId);
        if (!relativeId) {
            return null;
        }
        const parts = relativeId.split('.');
        if (parts.length !== 3 || parts[1] !== 'sendcommand') {
            return null;
        }
        const rawCommandId = parts[2];
        if (!this.commandDefinitions.has(rawCommandId)) {
            this.adapter.log.debug(`CommandService: Unknown command datapoint ${fullId}.`);
            return null;
        }
        return {
            deviceId: (0, helpers_1.normalizeDeviceId)(parts[0]),
            commandId: rawCommandId,
        };
    }
    async resolveDeviceIp(deviceId) {
        const ipState = await this.adapter.getStateAsync(`${deviceId}.ip_addr`);
        const ipAddress = typeof ipState?.val === 'string' ? ipState.val.trim() : '';
        return ipAddress || null;
    }
    getCommandStateId(deviceId, commandId) {
        return `${deviceId}.sendcommand.${commandId}`;
    }
    getConfirmedCommandValueCacheKey(deviceId, commandId) {
        return `${deviceId}:${commandId}`;
    }
    async hasConfirmedCommandValue(stateId, deviceId, commandId, targetValue) {
        const cacheKey = this.getConfirmedCommandValueCacheKey(deviceId, commandId);
        const cachedValue = this.confirmedCommandValueCache.get(cacheKey);
        if (cachedValue === targetValue) {
            return true;
        }
        const state = await this.adapter.getStateAsync(stateId);
        const currentValue = Number(state?.val);
        if (state?.ack === true && Number.isFinite(currentValue)) {
            const normalizedCurrentValue = Math.round(currentValue);
            this.confirmedCommandValueCache.set(cacheKey, normalizedCurrentValue);
            return normalizedCurrentValue === targetValue;
        }
        return false;
    }
}
exports.default = CommandService;
//# sourceMappingURL=commandService.js.map
