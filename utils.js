'use strict';

const { determineRole } = require('./roles');

const FORBIDDEN_CHARS = /[^a-zA-Z0-9_-]/g;

function name2id(pName) {
    return (pName || '').replace(FORBIDDEN_CHARS, '_');
}

async function ensureStateExists(adapter, stateCache, statePath, obj) {
    const parentPath = statePath.substring(0, statePath.lastIndexOf('.'));
    if (parentPath && !stateCache.has(parentPath)) {
        const parentObj = await adapter.getObjectAsync(parentPath);
        if (!parentObj) {
            await adapter.setObject(parentPath, {
                type: 'channel',
                common: { name: '' },
                native: {},
            });
        }
        stateCache.add(parentPath);
    }

    if (!stateCache.has(statePath)) {
        const existingObj = await adapter.getObjectAsync(statePath);
        if (!existingObj) {
            await adapter.setObjectAsync(statePath, obj);
        }
        stateCache.add(statePath);
    }
}

async function getActiveDeviceId(adapter) {
    const aktivState = await adapter.getStateAsync('info.aktivCCU');
    if (!aktivState || !aktivState.val) {
        adapter.log.warn('getActiveDeviceId: No active CCU found in info.aktivCCU.');
        return null;
    }

    const deviceId = aktivState.val.split(',')[0].trim();  // Nur den ersten Teil des Strings
    if (!deviceId || deviceId === "null") {
        adapter.log.warn(`getActiveDeviceId: Invalid deviceId found: ${deviceId}`);
        return null;
    }
    return deviceId;
}

function getDateValue(date) {
    return date?.month * 100 + date?.day;
}

async function processNestedData(adapter, basePath, data, stateCache) {
    for (const key in data) {
        if (!data.hasOwnProperty(key)) continue;

        const value = data[key];
        const safeId = name2id(key);
        const stateId = `${basePath}.${safeId}`;

        if (Array.isArray(value)) {
            for (let index = 0; index < value.length; index++) {
                await processNestedData(adapter, `${stateId}.${index}`, value[index], stateCache);
            }
        } else if (typeof value === 'object' && value !== null) {
            await processNestedData(adapter, stateId, value, stateCache);
        } else {
            const role = determineRole(key);
            await ensureStateExists(adapter, stateCache, stateId, {
                type: 'state',
                common: {
                    name: key,
                    type: typeof value,
                    role,
                    read: true,
                    write: false,
                },
                native: {},
            });

            await adapter.setStateAsync(stateId, { val: value, ack: true });
        }
    }
}

async function applySocValue(adapter, deviceId, value, type) {
    const datapoint = `${adapter.namespace}.${deviceId}.sendcommand.${type}`;
    try {
        await adapter.setStateAsync(datapoint, { val: value, ack: false });
    } catch (err) {
        adapter.log.error(`applySocValue failed for ${datapoint}: ${err.message}`);
    }
}

function validateInterval(value, min = 1000, max = 3600000) {
    if (typeof value !== 'number' || isNaN(value)) {
        return min;
    }
    if (value < min) {
        return min;
    }
    if (value > max) {
        return max;
    }
    return value;
}

module.exports = {
    name2id,
    ensureStateExists,
    getActiveDeviceId,
    processNestedData,
    getDateValue,
    applySocValue,
    validateInterval,
};
