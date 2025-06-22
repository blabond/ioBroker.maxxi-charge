'use strict';

const utils = require('@iobroker/adapter-core');
const { validateInterval, getActiveDeviceId } = require('./utils'); // utils importieren
const Commands = require('./commands');
const LocalApi = require('./localApi');
const CloudApi = require('./cloudApi');
const CloudApiStable = require('./cloudApi_stable');
const VersionControl = require('./versionControl');
const EcoMode = require('./ecoMode');
const BatteryMode = require('./batteryMode');
const BKWMode = require('./bkwMode');

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
        this.commands = new Commands(this);
        this.localApi = new LocalApi(this);
        this.cloudApi = null;
        this.cloudApi_backup = null;
        this.ecoMode = new EcoMode(this);
        this.versionControl = new VersionControl(this);
        this.batteryMode = new BatteryMode(this);
        this.bkwMode = new BKWMode(this, this.commands);

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
                    role: 'text',
                    read: true,
                    write: false,
                },
                native: {},
            });

            if (this.config.apimode === 'local') {
                await this.localApi.init();
            } else if (this.config.apimode === 'cloud') {
                this.cloudApi = new CloudApi(this); // V1
                await this.cloudApi.init(); // Cloud V1
            } else if (this.config.apimode === 'cloud_v2') {
                this.cloudApiStable = new CloudApiStable(this); // V2
                await this.cloudApiStable.init(); // Cloud V2
            }

            // Version Control
            await this.versionControl.init();

            // Cleanup-Intervall
            this.cleanupInterval = this.setInterval(() => this.cleanupActiveDevices(), validateInterval(30 * 1000));

            // EcoMode initialisieren, falls aktiviert
            if (this.config.enableseasonmode && this.config.batterycalibration === false) {
                await this.ecoMode.init();
            }

            if (this.config.batterycalibration && this.config.batterycalibration === true) {
                await this.batteryMode.init();
            }
        } catch (error) {
            this.log.error(`Fatal error during initialization: ${error.message}`);
        }
    }

    async onStateChange(id, state) {
        // this.log.debug(`State changed: ${id}, Value: ${state.val}, Ack: ${state.ack}`);

        if (!state.ack) {
            if (id.includes('.VersionControl.')) {
                await this.versionControl.handleStateChange(id, state);
            } else {
                await this.commands.handleCommandChange(id, state);
            }
        } else {
            if (id.endsWith('.SOC')) {
                await this.ecoMode.handleSOCChange(id, state);
                await this.batteryMode.handleCalibrationSOCChange(id, state);
                await this.bkwMode.handleSOCChange(id, state);
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
        // remove devices that haven't sent data in the last 90 seconds
        const ninetySecAgo = now - 90 * 1000;

        for (const deviceId in this.activeDevices) {
            if (this.activeDevices[deviceId] < ninetySecAgo) {
                delete this.activeDevices[deviceId];
                this.log.warn(`Device ${deviceId} marked as inactive and removed.`);
            }
        }

        const keys = Object.keys(this.activeDevices);
        await this.setState('info.aktivCCU', { val: keys.join(','), ack: true });
        await this.setState('info.connection', { val: keys.length > 0, ack: true });
    }

    async onUnload(callback) {
        try {
            // Prüfen, ob das Objekt vor dem Setzen existiert
            const connectionObj = await this.getObjectAsync('info.connection');
            if (connectionObj) {
                await this.setState('info.connection', { val: false, ack: true });
            }

            const aktivCcuObj = await this.getObjectAsync('info.aktivCCU');
            if (aktivCcuObj) {
                await this.setState('info.aktivCCU', { val: '', ack: true });
            }

            // Andere Bereinigungen
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
            if (this.cloudApi_backup) {
                this.cloudApi_backup.cleanup();
            }
            if (this.versionControl) {
                this.versionControl.cleanup();
            }

            if (this.bkwMode) {
                this.bkwMode.cleanup();
            }

            // Timer/Intervalle entfernen
            if (this.cleanupInterval) {
                this.clearInterval(this.cleanupInterval);
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
