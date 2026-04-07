"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const helpers_1 = require("../utils/helpers");
const roles_1 = require("../utils/roles");
const DYNAMIC_FOLDER_KEYS = new Set(["batteriesInfo", "convertersInfo"]);
function getStateType(value) {
    if (value === null) {
        return "mixed";
    }
    if (Array.isArray(value)) {
        return "array";
    }
    if (typeof value === "boolean") {
        return "boolean";
    }
    if (typeof value === "number") {
        return "number";
    }
    if (typeof value === "string") {
        return "string";
    }
    return "mixed";
}
function isContainerValue(value) {
    return Array.isArray(value) || (0, helpers_1.isRecord)(value);
}
function createComparableExistingObject(existingObject, desiredDefinition) {
    const comparableCommon = {};
    const comparableNative = {};
    for (const key of Object.keys(desiredDefinition.common)) {
        comparableCommon[key] = existingObject.common[key];
    }
    for (const key of Object.keys(desiredDefinition.native)) {
        comparableNative[key] = existingObject.native[key];
    }
    return (0, helpers_1.buildComparableObjectDefinition)({
        type: existingObject.type,
        common: comparableCommon,
        native: comparableNative,
    });
}
class StateManager {
    adapter;
    objectDefinitionCache = new Map();
    stateValueCache = new Map();
    constructor(adapter) {
        this.adapter = adapter;
    }
    async ensureInfoStructure() {
        await this.ensureChannel("info", {
            name: {
                en: "Information",
                de: "Information",
            },
        });
        await this.ensureStateObject("info.connection", {
            name: {
                en: "Connection active",
                de: "Verbindung aktiv",
            },
            type: "boolean",
            role: "indicator.connected",
            read: true,
            write: false,
        });
        await this.ensureStateObject("info.aktivCCU", {
            name: {
                en: "Active CCUs",
                de: "Aktive CCUs",
            },
            type: "string",
            role: "text",
            read: true,
            write: false,
        });
    }
    async ensureDevice(deviceId) {
        await this.ensureObject(deviceId, {
            type: "device",
            common: { name: deviceId },
            native: {},
        });
    }
    async ensureChannel(id, common) {
        await this.ensureObject(id, {
            type: "channel",
            common,
            native: {},
        });
    }
    async ensureFolder(id, common) {
        await this.ensureObject(id, {
            type: "folder",
            common,
            native: {},
        });
    }
    async ensureStateObject(id, common) {
        await this.ensureObject(id, {
            type: "state",
            common,
            native: {},
        });
    }
    async setStateIfChanged(id, value, ack = true) {
        const cacheKey = `${ack}:${(0, helpers_1.serializeComparable)(value)}`;
        if (this.stateValueCache.get(id) === cacheKey) {
            return false;
        }
        const existingState = await this.adapter.getStateAsync(id);
        if (existingState &&
            existingState.ack === ack &&
            (0, helpers_1.areValuesEqual)(existingState.val, value)) {
            this.stateValueCache.set(id, cacheKey);
            return false;
        }
        await this.adapter.setStateAsync(id, { val: value, ack });
        this.stateValueCache.set(id, cacheKey);
        return true;
    }
    async setInfoStates(deviceIds) {
        const uniqueDeviceIds = [...new Set(deviceIds)];
        await this.setStateIfChanged("info.aktivCCU", uniqueDeviceIds.join(","), true);
        await this.setStateIfChanged("info.connection", uniqueDeviceIds.length > 0, true);
    }
    async resetInfoStates() {
        await this.setInfoStates([]);
    }
    async syncDevicePayload(deviceId, payload) {
        await this.ensureDevice(deviceId);
        await this.syncPayloadRecursive(deviceId, payload);
    }
    async syncSettingsPayload(deviceId, payload) {
        await this.ensureDevice(deviceId);
        await this.ensureChannel(`${deviceId}.settings`, { name: "settings" });
        await this.syncPayloadRecursive(`${deviceId}.settings`, payload);
    }
    clearCaches() {
        this.objectDefinitionCache.clear();
        this.stateValueCache.clear();
    }
    async ensureObject(id, definition) {
        const fingerprint = (0, helpers_1.buildComparableObjectDefinition)({
            type: definition.type,
            common: definition.common,
            native: definition.native,
        });
        if (this.objectDefinitionCache.get(id) === fingerprint) {
            return;
        }
        const existingObject = await this.adapter.getObjectAsync(id);
        if (!existingObject) {
            await this.adapter.setObjectNotExistsAsync(id, this.toSettableObject(definition));
            this.objectDefinitionCache.set(id, fingerprint);
            return;
        }
        const existingFingerprint = createComparableExistingObject(existingObject, definition);
        if (existingFingerprint !== fingerprint) {
            if (existingObject.type !== definition.type) {
                this.adapter.log.warn(`StateManager: Object ${id} exists with unexpected type ${existingObject.type}; expected ${definition.type}.`);
            }
            await this.adapter.extendObjectAsync(id, {
                ...this.toPartialObject(definition),
            });
        }
        this.objectDefinitionCache.set(id, fingerprint);
    }
    async syncPayloadRecursive(parentId, payload) {
        if (!isContainerValue(payload)) {
            return;
        }
        const entries = Array.isArray(payload)
            ? payload.map((value, index) => [String(index), value])
            : Object.entries(payload);
        for (const [rawKey, value] of entries) {
            const key = String(rawKey);
            const safeKey = (0, helpers_1.nameToId)(key);
            const id = `${parentId}.${safeKey}`;
            if (isContainerValue(value)) {
                const isFolder = Array.isArray(value) || DYNAMIC_FOLDER_KEYS.has(key);
                if (isFolder) {
                    await this.ensureFolder(id, { name: key });
                }
                else {
                    await this.ensureChannel(id, { name: key });
                }
                await this.syncPayloadRecursive(id, value);
                continue;
            }
            const stateValue = this.normalizeStateValue(value);
            if (typeof stateValue === "undefined") {
                continue;
            }
            await this.ensureStateObject(id, {
                name: key,
                type: getStateType(stateValue),
                role: (0, roles_1.determineRole)(key),
                read: true,
                write: false,
            });
            await this.setStateIfChanged(id, stateValue, true);
        }
    }
    normalizeStateValue(value) {
        if (value === null ||
            typeof value === "boolean" ||
            typeof value === "number" ||
            typeof value === "string") {
            return value;
        }
        return undefined;
    }
    toSettableObject(definition) {
        switch (definition.type) {
            case "device":
                return definition;
            case "channel":
                return definition;
            case "folder":
                return definition;
            case "state":
                return {
                    ...definition,
                    common: definition.common,
                };
        }
    }
    toPartialObject(definition) {
        switch (definition.type) {
            case "device":
                return definition;
            case "channel":
                return definition;
            case "folder":
                return definition;
            case "state":
                return {
                    ...definition,
                    common: definition.common,
                };
        }
    }
}
exports.default = StateManager;
//# sourceMappingURL=stateManager.js.map