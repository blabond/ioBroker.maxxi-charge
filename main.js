'use strict';

const utils = require('@iobroker/adapter-core');
const axios = require('axios');

const localApi = require('./localApi');
const cloudApi = require('./cloudApi');
const EcoMode = require('./ecoMode');

class MaxxiCharge extends utils.Adapter {
    constructor(options) {
        super({
            ...options,
            name: 'maxxi-charge',
        });

        this.on('ready', this.onReady.bind(this));
        this.on('unload', this.onUnload.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));

        this.infoInterval = null;
        this.ccuInterval = null;
        this.cleanInterval = null;
        this.commandInitialized = false;
        this.apiMode = null;
        this.maxxiCcuName = null;

        this.activeDevices = {};

        this.commandDatapoints = [
            { id: "maxOutputPower", description: "Mikro-Wechselrichter maximale Leistung (Watt)", type: "number", min: 300, max: 1800, default: 0 },
            { id: "offlinePower", description: "Offline-Ausgangsleistung (Watt)", type: "number", min: 50, max: 600, default: 0 },
            { id: "baseLoad", description: "Ausgabe korrigieren (Watt)", type: "number", min: -100, max: 100, default: 0 },
            { id: "threshold", description: "Reaktionstoleranz (Watt)", type: "number", min: 5, max: 50, default: 0 },
            { id: "minSOC", description: "Minimale Entladung der Batterie", type: "number", min: 2, max: 95, default: 0 },
            { id: "maxSOC", description: "Maximale Entladung der Batterie", type: "number", min: 20, max: 100, default: 0 },
            { id: "dcAlgorithm", description: "Steuerungsverhalten der CCU (Algorithmus)", type: "number", states: { 1: "Basic (0.38)", 2: "Forced (0.40+)" }, default: 0 },
        ];
    }

   async onReady() {
		this.apiMode = this.config.apiMode || "cloud";
		this.maxxiCcuName = this.config.maxxiCcuName || "";

		if (this.apiMode === "cloud") {
			if (!this.maxxiCcuName) {
				this.log.warn("Cloud-Modus ausgewählt, aber 'maxxiCcuName' ist nicht gesetzt. Der Cloud-Modus wird nicht ausgeführt.");
			} else {
				await cloudApi.setupCloudAPI(this);
			}
		} else if (this.apiMode === "local") {
			await localApi.setupLocalAPI(this);
		}

		await this.setObjectNotExistsAsync("info.aktivCCU", {
			type: "state",
			common: { name: "Aktive CCUs", type: "string", role: "value", read: true, write: false },
			native: {}
		});
		await this.setObjectNotExistsAsync("info.connection", {
			type: "state",
			common: { name: "Verbindung aktiv", type: "boolean", role: "indicator.connected", read: true, write: false },
			native: {}
		});

		await this.setStateAsync("info.aktivCCU", { val: "", ack: true });
		await this.setStateAsync("info.connection", { val: false, ack: true });

		this.cleanInterval = setInterval(() => this.cleanupActiveDevices(), 60 * 1000);

		// IP-Adresse des Hosts ermitteln
		const hostObject = await this.getForeignObjectAsync(`system.host.${this.host}`);
		let ipAddress = "127.0.0.1"; // Fallback, falls keine IP gefunden wird

		if (hostObject && hostObject.native && hostObject.native.hardware) {
			const networkInterfaces = hostObject.native.hardware.networkInterfaces;
			for (const ifaceName in networkInterfaces) {
				const iface = networkInterfaces[ifaceName];
				for (const address of iface) {
					if (!address.internal && address.family === 'IPv4') {
						ipAddress = address.address; 
						break;
					}
				}
				if (ipAddress !== "127.0.0.1") break;
			}
		}

		await this.setObjectNotExistsAsync("info.hostIp", {
			type: "state",
			common: { name: "Host-IP-Adresse", type: "string", role: "info.ip", read: true, write: false },
			native: {}
		});
		await this.setStateAsync("info.hostIp", { val: ipAddress, ack: true });

		// this.log.info(`Ermittelte IP-Adresse des Hosts: ${ipAddress}`);

		// EcoMode initialisieren
		this.ecoMode = new EcoMode(this);
		await this.ecoMode.init();

	}



    async processData(data, baseFolder, isCloud = false) {
        let basePath;
        try {
            if (!data.deviceId) {
                throw new Error("deviceId nicht vorhanden");
            }
            const folder = `${isCloud ? 'cloud' : 'local'}-${data.deviceId}`;
            basePath = `${folder}.${baseFolder}`;

            await this.processNestedData(basePath, data);
            this.updateActiveCCU(folder);

        } catch (err) {
            basePath = "error";
            this.log.warn(`Fehler beim Verarbeiten der Daten: ${err.message}`);

            const timestamp = new Date().toISOString();
            await this.ensureStateExists(`${basePath}.Timestamp`, timestamp, "string", "Zeitpunkt des Fehlers");
            await this.setStateAck(`${basePath}.Timestamp`, timestamp);

            await this.ensureStateExists(`${basePath}.ErrorMessage`, err.message, "string", "Fehlermeldung");
            await this.setStateAck(`${basePath}.ErrorMessage`, err.message);
        }
    }

    async processNestedData(basePath, data) {
        for (const key in data) {
            if (!data.hasOwnProperty(key)) continue;

            const value = data[key];
            const stateId = `${basePath}.${key}`;

            if (Array.isArray(value)) {
                for (let index = 0; index < value.length; index++) {
                    await this.processNestedData(`${stateId}.${index}`, value[index]);
                }
            } else if (typeof value === "object" && value !== null) {
                await this.processNestedData(stateId, value);
            } else {
                await this.setObjectNotExistsAsync(stateId, {
                    type: "state",
                    common: {
                        name: key,
                        type: typeof value,
                        role: "value",
                        read: true,
                        write: false,
                    },
                    native: {},
                });

                await this.setStateAsync(stateId, { val: value, ack: true });
            }
        }
    }

    async initializeCommandSettings(deviceFolder, ipAddress) {
        const namespace = `${deviceFolder}.sendcommand`;

        for (const dp of this.commandDatapoints) {
            const fullPath = `${namespace}.${dp.id}`;

            const obj = await this.getObjectAsync(fullPath);
            if (!obj) {
                await this.setObjectNotExistsAsync(fullPath, {
                    type: 'state',
                    common: {
                        name: dp.description,
                        type: dp.type,
                        role: 'value',
                        read: true,
                        write: true
                    },
                    native: {}
                });

                await this.setStateAsync(fullPath, { val: dp.default, ack: true });

                await this.extendObjectAsync(fullPath, {
                    common: {
                        min: dp.min,
                        max: dp.max,
                        states: dp.states || undefined
                    }
                });

                this.subscribeStates(fullPath);
            } else {
                const currentObj = await this.getObjectAsync(fullPath);
                const common = currentObj.common || {};
                let needUpdate = false;

                if (common.min !== dp.min || common.max !== dp.max || JSON.stringify(common.states || {}) !== JSON.stringify(dp.states || {})) {
                    needUpdate = true;
                }

                if (needUpdate) {
                    await this.extendObjectAsync(fullPath, {
                        common: {
                            min: dp.min,
                            max: dp.max,
                            states: dp.states || undefined
                        }
                    });
                }

                this.subscribeStates(fullPath);
            }
        }
    }

    updateActiveCCU(folder) {
        const now = Date.now();
        this.activeDevices[folder] = now;
        this.refreshActiveCCUState();
    }

    refreshActiveCCUState() {
        const keys = Object.keys(this.activeDevices);
        const csv = keys.join(',');

        this.setStateAsync("info.aktivCCU", { val: csv, ack: true });
        this.setStateAsync("info.connection", { val: keys.length > 0, ack: true });
    }

    cleanupActiveDevices() {
        const now = Date.now();
        const fiveMinAgo = now - 5 * 60 * 1000; // 5min
        let changed = false;

        for (const dev in this.activeDevices) {
            if (this.activeDevices[dev] < fiveMinAgo) {
                delete this.activeDevices[dev];
                changed = true;
                this.log.info(`Gerät ${dev} wurde als inaktiv entfernt, da länger als 5min keine Daten.`);
            }
        }

        if (changed) {
            this.refreshActiveCCUState();
        }
    }

    async onStateChange(id, state) {
		if (this.ecoMode && typeof this.ecoMode.onStateChange === 'function') {
			await this.ecoMode.onStateChange(id, state);
		}
	
        if (!state || state.ack) return;

        const parts = id.split(".");
        const deviceId = parts[2]; 
        const datapointId = parts[parts.length - 1];

        const datapoint = this.commandDatapoints.find((dp) => dp.id === datapointId);
        if (!datapoint) {
            this.log.warn(`Unbekannter Datenpunkt: ${id}`);
            return;
        }

        if (datapoint.min !== undefined && state.val < datapoint.min) {
            this.log.warn(`Wert für ${datapointId} zu klein. Minimum: ${datapoint.min}`);
            await this.setStateAsync(id, { val: datapoint.min, ack: true });
            return;
        }

        if (datapoint.max !== undefined && state.val > datapoint.max) {
            this.log.warn(`Wert für ${datapointId} zu groß. Maximum: ${datapoint.max}`);
            await this.setStateAsync(id, { val: datapoint.max, ack: true });
            return;
        }

        const ipPath = `${deviceId}.systeminfo.ip_addr`;
        const ipState = await this.getStateAsync(ipPath);

        if (!ipState || !ipState.val) {
            this.log.error(`Keine IP-Adresse für Gerät ${deviceId} gefunden. Erwarteter Pfad: ${ipPath}`);
            return;
        }

        try {
            await axios.post(`http://${ipState.val}/config`, `${datapointId}=${state.val}`, {
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
            });
            this.log.info(`Wert ${datapointId} erfolgreich an CCU gesendet: ${state.val}`);
        } catch (error) {
            this.log.error(`Fehler beim Senden des Wertes ${datapointId}: ${error.message}`);
        }
    }

    onUnload(callback) {
        try {
            if (this.infoInterval) clearInterval(this.infoInterval);
            if (this.ccuInterval) clearInterval(this.ccuInterval);
            if (this.cleanInterval) clearInterval(this.cleanInterval);

            if (this.server) {
                this.server.close(() => {
                 //   this.log.info("MaxxiCharge Local API wurde gestoppt");
                    callback();
                });
            } else {
                callback();
            }
        } catch (e) {
            callback();
        }
    }

    async ensureStateExists(stateId, initialValue, valueType, desc) {
        await this.setObjectNotExistsAsync(stateId, {
            type: "state",
            common: {
                name: desc,
                type: valueType,
                role: "value",
                read: true,
                write: false,
            },
            native: {},
        });
        await this.setStateAck(stateId, initialValue);
    }

    async setStateAck(stateId, value) {
        await this.setStateAsync(stateId, { val: value, ack: true });
    }

    extractClientIp(req) {
        let ip = req.socket.remoteAddress || '';
        if (ip.startsWith('::ffff:')) {
            ip = ip.substring(7);
        }
        return ip;
    }
	
	async onUnload(callback) {
		try {
			// 1. EcoMode aufräumen
			if (this.ecoMode && typeof this.ecoMode.cleanup === 'function') {
				await this.ecoMode.cleanup();
			}

			// 2. Local API aufräumen
			if (this.localApi && typeof this.localApi.cleanup === 'function') {
				await this.localApi.cleanup();
			}

			// 3. Cloud API aufräumen
			if (this.cloudApi && typeof this.cloudApi.cleanup === 'function') {
				await this.cloudApi.cleanup();
			}

			// 4. Allgemeine Abos abmelden (falls gesetzt)
			this.unsubscribeStates('info.connection');

			this.log.info('Adapter wurde sauber beendet.');
			callback();
		} catch (err) {
			this.log.error(`Fehler beim Beenden des Adapters: ${err.message}`);
			callback();
		}
	}

}

if (require.main !== module) {
    module.exports = (options) => new MaxxiCharge(options);
} else {
    new MaxxiCharge();
}
