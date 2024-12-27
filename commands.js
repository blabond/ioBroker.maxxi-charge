'use strict';

const { name2id, ensureStateExists } = require('./utils');
const axios = require('axios');

class Commands {
    constructor(adapter) {
        this.adapter = adapter;
        this.stateCache = new Set(); // Cache für bestehende States
        this.commandDatapoints = [
            {
                id: "maxOutputPower",
                description: { en: "Micro-inverter maximum power (W)", de: "Mikrowechselrichter maximale Leistung (W)" },
                type: "number",
                min: 300,
                max: 1800
            },
            {
                id: "offlinePower",
                description: { en: "Offline output power (W)", de: "Offline-Ausgangsleistung (W)" },
                type: "number",
                min: 50,
                max: 600
            },
            {
                id: "baseLoad",
                description: { en: "Adjust output (W)", de: "Ausgabe anpassen (W)" },
                type: "number",
                min: -100,
                max: 100
            },
            {
                id: "threshold",
                description: { en: "Response tolerance (W)", de: "Reaktionstoleranz (W)" },
                type: "number",
                min: 5,
                max: 50
            },
            {
                id: "minSOC",
                description: { en: "Minimum battery discharge", de: "Minimale Batterieentladung" },
                type: "number",
                min: 2,
                max: 95
            },
            {
                id: "maxSOC",
                description: { en: "Maximum battery discharge", de: "Maximale Batterieentladung" },
                type: "number",
                min: 20,
                max: 100
            },
            {
                id: "dcAlgorithm",
                description: { en: "CCU control behavior (algorithm)", de: "Steuerungsverhalten der CCU (Algorithmus)" },
                type: "number",
                states: { 1: { en: "Basic (0.38)", de: "Basis (0.38)" }, 2: { en: "Forced (0.40+)", de: "Erzwungen (0.40+)" } }
            }
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
                    role: 'value',
                    read: true,
                    write: true,
                    min: dp.min,
                    max: dp.max,
                    states: dp.states || undefined,
                },
                native: {},
            });

            // Datenpunkt-Abonnieren
            this.adapter.subscribeStates(fullPath);
        }
    }



    async handleCommandChange(id, state) {
        if (!state || state.ack) return;

        const parts = id.split(".");
        const deviceId = name2id(parts[2]);
        const datapointId = parts[parts.length - 1];

        const commandDatapoint = this.commandDatapoints.find((dp) => dp.id === datapointId);
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

        const ipPath = `${deviceId}.ip_addr`;
        const ipState = await this.adapter.getStateAsync(ipPath);

        if (!ipState || !ipState.val) {
            this.adapter.log.error(`No IP address found for device ${deviceId}. Expected path: ${ipPath}`);
            return;
        }

        try {
            const url = `http://${ipState.val}/config`;
            const payload = `${datapointId}=${state.val}`;
            await axios.post(url, payload, {
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                timeout: 15000 // Timeout in Millisekunden, hier 15 Sekunden
            });
            this.adapter.log.info(`Command ${datapointId} successfully sent to device ${deviceId}: ${state.val}`);
        } catch (error) {
            this.adapter.log.error(`Error sending command ${datapointId} to device ${deviceId}: ${error.message}`);
        }
    }
}

module.exports = Commands;