'use strict';

const { name2id, ensureStateExists } = require('./utils');
const axios = require('axios');

class Commands {
    constructor(adapter) {
        this.adapter = adapter;
        this.stateCache = new Set(); // Cache für bestehende States
        this.commandDatapoints = [
            {
                id: 'maxOutputPower',
                description: {
                    en: 'Micro-inverter maximum power (W)',
                    de: 'Mikrowechselrichter maximale Leistung (W)',
                },
                type: 'number',
                min: 300,
                max: 2300,
                role: 'level',
            },
            {
                id: 'offlinePower',
                description: { en: 'Offline output power (W)', de: 'Offline-Ausgangsleistung (W)' },
                type: 'number',
                min: 50,
                max: 600,
                role: 'level',
            },
            {
                id: 'baseLoad',
                description: { en: 'Adjust output (W)', de: 'Ausgabe anpassen (W)' },
                type: 'number',
                min: -100,
                max: 100,
                role: 'level',
            },
            {
                id: 'threshold',
                description: { en: 'Response tolerance (W)', de: 'Reaktionstoleranz (W)' },
                type: 'number',
                min: 5,
                max: 50,
                role: 'level',
            },
            {
                id: 'minSOC',
                description: { en: 'Minimum battery discharge', de: 'Minimale Batterieentladung' },
                type: 'number',
                min: 0,
                max: 99,
                role: 'level.min',
            },
            {
                id: 'maxSOC',
                description: { en: 'Maximum battery discharge', de: 'Maximale Batterieentladung' },
                type: 'number',
                min: 20,
                max: 100,
                role: 'level.max',
            },
            {
                id: 'dcAlgorithm',
                description: {
                    en: 'CCU control behavior (algorithm)',
                    de: 'Steuerungsverhalten der CCU (Algorithmus)',
                },
                type: 'number',
                states: { 1: 'Basic (0.38)', 2: 'Forced (0.40+)' },
                role: 'level',
            },
        ];
    }

    async initializeCommandSettings(deviceId) {
        const namespace = `${name2id(deviceId)}.sendcommand`;

        for (const dp of this.commandDatapoints) {
            const fullPath = `${namespace}.${dp.id}`;

            // Datenpunkt initialisieren (falls nicht existiert)
            await ensureStateExists(this.adapter, this.stateCache, fullPath, {
                type: 'state',
                common: {
                    name: dp.description,
                    type: dp.type,
                    role: dp.role || 'value',
                    read: true,
                    write: true,
                    min: dp.min,
                    max: dp.max,
                    states: dp.states || undefined,
                },
                native: {},
            });

            // Datenpunkt abonnieren
            this.adapter.subscribeStates(fullPath);
        }
    }

    async handleCommandChange(id, state) {
        if (!state || state.ack) {
            return;
        }

        const parts = id.split('.');
        const deviceId = name2id(parts[2]);
        const datapointId = parts[parts.length - 1];

        const commandDatapoint = this.commandDatapoints.find(dp => dp.id === datapointId);
        if (!commandDatapoint) {
            this.adapter.log.warn(`Unknown command datapoint: ${id}`);
            return;
        }

        if (commandDatapoint.min !== undefined && state.val < commandDatapoint.min) {
            this.adapter.log.warn(`Value for ${datapointId} is too small. Minimum: ${commandDatapoint.min}`);
            await this.adapter.setStateAsync(id, { val: commandDatapoint.min, ack: true });
            return;
        }

        if (commandDatapoint.max !== undefined && state.val > commandDatapoint.max) {
            this.adapter.log.warn(`Value for ${datapointId} is too large. Maximum: ${commandDatapoint.max}`);
            await this.adapter.setStateAsync(id, { val: commandDatapoint.max, ack: true });
            return;
        }

        let ipAddress;

        if (this.adapter.config.apimode === 'cloud_v2') {
            ipAddress = this.adapter.config.maxxiip;

            if (!ipAddress) {
                this.adapter.log.error(`No IP address configured for cloud mode.`);
                return;
            }
        } else {
            const ipPath = `${deviceId}.ip_addr`;
            const ipState = await this.adapter.getStateAsync(ipPath);

            if (!ipState || !ipState.val) {
                this.adapter.log.error(`No IP address found for device ${deviceId}. Expected path: ${ipPath}`);
                return;
            }

            ipAddress = ipState.val;
        }

        try {
            const url = `http://${ipAddress}/config`;
            const payload = `${datapointId}=${state.val}`;
            await axios.post(url, payload, {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                timeout: 15000, // Timeout in Millisekunden, hier 15 Sekunden
            });
            this.adapter.log.debug(`Command ${datapointId} successfully sent to device ${deviceId}: ${state.val}`);
        } catch (error) {
            this.adapter.log.error(`Error sending command ${datapointId} to device ${deviceId}: ${error.message}`);
        }
    }

    cleanup() {
        // Entfernt alle Abonnements für Zustandsänderungen
        this.commandDatapoints.forEach(dp => {
            const namespace = `${this.adapter.namespace}`;
            const fullPath = `${namespace}.sendcommand.${dp.id}`;
            this.adapter.unsubscribeStates(fullPath);
        });

        // Leert den State-Cache
        this.stateCache.clear();
    }
}

module.exports = Commands;
