'use strict';

const { determineRole } = require('./roles');

const FORBIDDEN_CHARS = /[^a-zA-Z0-9_-]/g;

function name2id(pName) {
    return (pName || '').replace(FORBIDDEN_CHARS, '_');
}

async function ensureStateExists(adapter, stateCache, statePath, obj) {
    const parentPath = statePath.substring(0, statePath.lastIndexOf('.'));

    // Überprüfe und erstelle den übergeordneten Ordner
    if (parentPath && !stateCache.has(parentPath)) {
        const isDevice = parentPath.split('.').pop().startsWith('maxxi-');
        const parentType = isDevice ? 'device' : 'channel';

        await adapter.setObjectNotExists(parentPath, {
            type: parentType,
            common: { name: '' },
            native: {},
        });
        stateCache.add(parentPath);
    }

    // Überprüfe und erstelle den aktuellen State oder Ordner
    if (!stateCache.has(statePath)) {
        await adapter.setObjectNotExists(statePath, obj);
        stateCache.add(statePath);
    }
}

async function getActiveDeviceId(adapter) {
    const aktivState = await adapter.getStateAsync('info.aktivCCU');
    if (!aktivState || !aktivState.val) {
        return null;
    }

    const deviceId = aktivState.val.split(',')[0].trim(); // Nur den ersten Teil des Strings
    if (!deviceId || deviceId === 'null') {
        adapter.log.warn(`getActiveDeviceId: Invalid deviceId found: ${deviceId}`);
        return null;
    }
    return deviceId;
}

function getDateValue(date) {
    return date?.month * 100 + date?.day;
}

async function processNestedData(adapter, basePath, data, stateCache) {
    const folderTypes = ['batteriesInfo', 'convertersInfo']; // Definition innerhalb der Funktion

    for (const key in data) {
        if (!Object.hasOwn(data, key)) {
            continue;
        }

        const value = data[key];
        const safeId = name2id(key);
        const stateId = `${basePath}.${safeId}`;

        // Bestimme den Typ basierend auf dem Filter
        const objectType = folderTypes.includes(key) ? 'folder' : 'channel';

        if (typeof value === 'object' && value !== null) {
            // Sicherstellen, dass der Ordner existiert
            await ensureStateExists(adapter, stateCache, stateId, {
                type: objectType,
                common: { name: key },
                native: {},
            });

            // Rekursiv die nächsten Ebenen verarbeiten
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

async function changeSettingAkku(adapter, batteryCalibration, calibrationProgress) {
    try {
        const adapterConfigPath = `system.adapter.${adapter.namespace}`;

        // Lade die Adapterkonfiguration
        const obj = await adapter.getForeignObjectAsync(adapterConfigPath);

        if (!obj) {
            adapter.log.error(`Adapter configuration not found for: ${adapterConfigPath}`);
            return;
        }

        // Ändere die gewünschten Werte
        if (typeof batteryCalibration === 'boolean') {
            obj.native.batterycalibration = batteryCalibration;
        }

        if (calibrationProgress === 'down' || calibrationProgress === 'up') {
            obj.native.calibrationProgress = calibrationProgress;
        }

        // Schreibe die Änderungen zurück
        await adapter.setForeignObject(adapterConfigPath, obj);

        adapter.log.debug(
            `Successfully updated batterycalibration to ${batteryCalibration} and calibrationProgress to ${calibrationProgress}.`,
        );
    } catch (error) {
        adapter.log.error(`Error in changeSettingAkku: ${error.message}`);
    }
}

module.exports = {
    name2id,
    ensureStateExists,
    getActiveDeviceId,
    processNestedData,
    getDateValue,
    applySocValue,
    validateInterval,
    changeSettingAkku,
};
