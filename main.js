'use strict';

const utils = require('@iobroker/adapter-core');
const { validateInterval, getActiveDeviceId } = require('./utils'); // utils importieren
const Commands = require('./commands');
const LocalApi = require('./localApi');
const CloudApi = require('./cloudApi');
const EcoMode = require('./ecoMode');
const BatteryMode = require('./batteryMode');

class MaxxiCharge extends utils.Adapter {
    constructor(options) {
        super({
            ...options,
            name: 'maxxi-charge',
        });

        this.on('ready', this.onReady.bind(this));
        this.on('unload', this.onUnload.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));

        this.activeDevices = {}; // Speichert aktive CCUs
        this.commands = new Commands(this); // Initialisiere Commands
        this.localApi = new LocalApi(this); // Initialisiere LocalApi
        this.cloudApi = null; // Platzhalter für CloudApi, wird in onReady initialisiert
        this.ecoMode = new EcoMode(this); // Initialisiere EcoMode
        this.batteryMode = new BatteryMode(this);

        this.maxxiccuname = ''; // Platzhalter, wird in onReady gesetzt
        this.stateCache = new Set(); // Cache für vorhandene States
    }

    async onReady() {
        try {
            this.subscribeStates('info.connection');

            // Setze info.connection und info.aktivCCU auf Standardwerte
            await this.setObjectNotExistsAsync('info.connection', {
                type: 'state',
                common: {
                    name: {
                        en: 'Connection active',
                        de: 'Verbindung aktiv',
                    },
                    type: 'boolean',
                    role: 'indicator.connected',
                    read: true,
                    write: false,
                },
                native: {},
            });

            await this.setObjectNotExistsAsync('info.aktivCCU', {
                type: 'state',
                common: {
                    name: {
                        en: 'Active CCUs',
                        de: 'Aktive CCUs',
                    },
                    type: 'string',
                    role: 'value',
                    read: true,
                    write: false,
                },
                native: {},
            });

            // Initialisiere APIs basierend auf dem Modus
            this.cloudApi = new CloudApi(this);

            if (this.config.apimode === 'local') {
                await this.localApi.init();
            } else if (this.config.apimode === 'cloud') {
                await this.cloudApi.init();
            }

            // Cleanup-Intervall
            this.cleanupInterval = this.setInterval(() => this.cleanupActiveDevices(), validateInterval(30 * 1000));

            // EcoMode initialisieren, falls aktiviert
            if (this.config.enableseasonmode && this.config.batterycalibration === false) {
                await this.ecoMode.init();
            }

            if (this.config.batterycalibration) {
                await this.batteryMode.init();
            }
        } catch (error) {
            this.log.error(`Fatal error during initialization: ${error.message}`);
        }
    }

    async onStateChange(id, state) {
        // this.log.debug(`State changed: ${id}, Value: ${state.val}, Ack: ${state.ack}`);

        if (!state.ack) {
            await this.commands.handleCommandChange(id, state);
        } else {
            if (id.endsWith('.SOC')) {
                await this.ecoMode.handleSOCChange(id, state);
                await this.batteryMode.handleCalibrationSOCChange(id, state);
            }

            if (id === `${this.namespace}.info.connection` && !state.val) {
                this.ecoMode.cleanup();

                const deviceId = await getActiveDeviceId(this);
                if (deviceId) {
                    const socState = `${this.namespace}.${deviceId}.SOC`;
                    this.unsubscribeStates(socState);
                    this.log.debug(`Unsubscribed from dynamic state: ${socState}`);
                }
            }
        }
    }

    async subscribeDynamicStates(deviceId) {
        const socState = `${this.namespace}.${deviceId}.SOC`;
        this.subscribeStates(socState);
    }

    async updateActiveCCU(deviceId) {
        this.activeDevices[deviceId] = Date.now();

        const keys = Object.keys(this.activeDevices);
        const csv = keys.join(',');

        // Zwischenspeicher für den letzten Zustand von `info.connection`
        if (!this.lastConnectionState) {
            this.lastConnectionState = false;
        }

        const isConnected = keys.length > 0;
        if (this.lastConnectionState !== isConnected) {
            // Zustand hat sich geändert, also aktualisieren
            await this.setState('info.connection', { val: isConnected, ack: true });
            this.lastConnectionState = isConnected;

            if (isConnected) {
                await this.subscribeDynamicStates(deviceId);
                if (this.config.enableseasonmode && !this.ecoModeInitialized) {
                    this.ecoModeInitialized = true; // Sicherstellen, dass `EcoMode` nur einmal gestartet wird
                    await this.ecoMode.startMonitoring();
                }
            }
        }

        // `info.aktivCCU` immer aktualisieren
        await this.setState('info.aktivCCU', { val: csv, ack: true });
    }

    async cleanupActiveDevices() {
        const now = Date.now();
        const fiveMinAgo = now - 90 * 1000;

        for (const deviceId in this.activeDevices) {
            if (this.activeDevices[deviceId] < fiveMinAgo) {
                delete this.activeDevices[deviceId];
                this.log.info(`Device ${deviceId} marked as inactive and removed.`);
            }
        }

        const keys = Object.keys(this.activeDevices);
        await this.setState('info.aktivCCU', { val: keys.join(','), ack: true });
        await this.setState('info.connection', { val: keys.length > 0, ack: true });
    }

    async onUnload(callback) {
        try {
            // Setze die States auf Standardwerte
            await this.setState('info.connection', { val: false, ack: true });
            await this.setState('info.aktivCCU', { val: '', ack: true });

            // Aufräumen aller Komponenten
            if (this.commands) {
                this.commands.cleanup();
            }
            if (this.ecoMode) {
                this.ecoMode.cleanup();
            }
            if (this.batteryMode) {
                this.batteryMode.cleanup();
            }
            if (this.localApi) {
                this.localApi.cleanup();
            }
            if (this.cloudApi) {
                this.cloudApi.cleanup();
            }

            // Bereinige vorhandene Timer und Intervalle
            if (this.cleanupInterval) {
                this.clearInterval(this.cleanupInterval);
            }

            // Bereinige dynamische States, falls noch abonniert
            const activeDevices = Object.keys(this.activeDevices || {});
            for (const deviceId of activeDevices) {
                const socState = `${this.namespace}.${deviceId}.SOC`;
                this.unsubscribeStates(socState);
            }

            callback();
        } catch (e) {
            this.log.error(`Error during shutdown: ${e.message}`);
            callback();
        }
    }
}

if (require.main !== module) {
    module.exports = options => new MaxxiCharge(options);
} else {
    new MaxxiCharge();
}
