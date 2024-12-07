'use strict';

const utils = require('@iobroker/adapter-core');
const http = require('http');
const axios = require('axios');

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

        // Aktive Devices: { "cloud-DeviceID": timestamp, "local-DeviceID": timestamp }
        this.activeDevices = {};

        // Sendcommand-Datenpunkte
        this.commandDatapoints = [
            { id: "maxOutputPower", description: "Maximale CCU Watt-Leistung", type: "number", min: 200, max: 1800, default: 0 },
            { id: "offlinePower", description: "Fallback-Stromabgabe", type: "number", min: 100, max: 600, default: 0 },
            { id: "baseLoad", description: "Stromzähler-Korrektur", type: "number", min: -300, max: 300, default: 0 },
            { id: "threshold", description: "Reaktionstoleranz", type: "number", min: 10, max: 150, default: 0 },
            { id: "minSOC", description: "Minimale Entladung", type: "number", min: 2, max: 90, default: 0 },
            { id: "maxSOC", description: "Maximale Akkuladung", type: "number", min: 30, max: 100, default: 0 },
            { id: "dcAlgorithm", description: "Steuerungsverhalten der CCU", type: "number", states: { 1: "Basic (0.38)", 2: "Forced (0.40+)" }, default: 0 },
        ];
    }

    async onReady() {
        this.apiMode = this.config.apiMode || "cloud";
        this.maxxiCcuName = this.config.maxxiCcuName || "";

        if (!this.maxxiCcuName) {
            this.log.warn("Kein maxxiCcuName gesetzt. Weder Cloud- noch Local-Mode wird ausgeführt.");
            return;
        }

        // Info-Ordner vorbereiten
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

        // Intervall zum Aufräumen inaktiver CCUs
        this.cleanInterval = setInterval(() => this.cleanupActiveDevices(), 60 * 1000); // alle 60s prüfen

        if (this.apiMode === "local") {
            await this.setupLocalAPI();
        } else {
            await this.setupCloudAPI();
        }
    }

    async setupLocalAPI() {
        const localApiPort = this.config.localApiPort || 5501;

        this.server = http.createServer((req, res) => {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Content-Length, X-Requested-With');

            if (req.method === 'OPTIONS') {
                res.writeHead(200);
                res.end();
                return;
            }

            if (req.method === 'POST') {
                let body = '';
                req.on('data', chunk => (body += chunk));
                req.on('end', async () => {
                   // this.log.info('MaxxiCharge Local API: Empfangener POST Body: ' + body);
                    try {
                        const data = JSON.parse(body);

                        const deviceId = data.deviceId || 'UnknownDevice';
                        const folder = `local-${deviceId}`;

                        await this.processLocalData(folder, data);

                        const ipAddress = this.extractClientIp(req);
                        await this.ensureStateExists(`${folder}.systeminfo.ip_addr`, ipAddress, "string", "IP-Adresse der Quelle");
                        await this.setStateAck(`${folder}.systeminfo.ip_addr`, ipAddress);

                        this.updateActiveCCU(folder);

                        if (!this.commandInitialized && data.deviceId) {
                            await this.initializeCommandSettings(folder, ipAddress);
                            this.commandInitialized = true;
                        }

                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ status: 'ok' }));
                    } catch (err) {
                        this.log.error('MaxxiCharge Local API: Fehler beim Parsen des JSON: ' + err);
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'invalid JSON' }));
                    }
                });
            } else {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('Not found');
            }
        });

        this.server.listen(localApiPort, () => {
            this.log.info(`MaxxiCharge Local API empfang gestartet auf Port ${localApiPort}`);
        });
    }

    async processLocalData(folder, data) {
        await this.setObjectNotExistsAsync(`${folder}.deviceId`, {
            type: 'state',
            common: { name: 'deviceId', type: 'string', role: 'value', read: true, write: false },
            native: {}
        });
        await this.setStateAsync(`${folder}.deviceId`, data.deviceId || '', true);

        await this.setObjectNotExistsAsync(`${folder}.SOC`, {
            type: 'state',
            common: { name: 'SOC', type: 'number', role: 'value', read: true, write: false },
            native: {}
        });
        await this.setStateAsync(`${folder}.SOC`, data.SOC || 0, true);

        await this.setObjectNotExistsAsync(`${folder}.wifiStrength`, {
            type: 'state',
            common: { name: 'wifiStrength', type: 'number', role: 'value', read: true, write: false },
            native: {}
        });
        await this.setStateAsync(`${folder}.wifiStrength`, data.wifiStrength || 0, true);

        await this.setObjectNotExistsAsync(`${folder}.Pccu`, {
            type: 'state',
            common: { name: 'Pccu', type: 'number', role: 'value', read: true, write: false },
            native: {}
        });
        await this.setStateAsync(`${folder}.Pccu`, data.Pccu || 0, true);

        await this.setObjectNotExistsAsync(`${folder}.Pr`, {
            type: 'state',
            common: { name: 'Pr', type: 'number', role: 'value', read: true, write: false },
            native: {}
        });
        await this.setStateAsync(`${folder}.Pr`, data.Pr || 0, true);

        await this.setObjectNotExistsAsync(`${folder}.PV_power_total`, {
            type: 'state',
            common: { name: 'PV_power_total', type: 'number', role: 'value', read: true, write: false },
            native: {}
        });
        await this.setStateAsync(`${folder}.PV_power_total`, data.PV_power_total || 0, true);

        await this.setObjectNotExistsAsync(`${folder}.firmwareVersion`, {
            type: 'state',
            common: { name: 'firmwareVersion', type: 'number', role: 'value', read: true, write: false },
            native: {}
        });
        await this.setStateAsync(`${folder}.firmwareVersion`, data.firmwareVersion || 0, true);

        await this.setObjectNotExistsAsync(`${folder}.date`, {
            type: 'state',
            common: { name: 'date', type: 'number', role: 'value.time', read: true, write: false },
            native: {}
        });
        await this.setStateAsync(`${folder}.date`, data.date || 0, true);

        if (Array.isArray(data.batteriesInfo) && data.batteriesInfo.length > 0) {
            await this.setObjectNotExistsAsync(`${folder}.batteryCapacity`, {
                type: 'state',
                common: { name: 'batteryCapacity', type: 'number', role: 'value', read: true, write: false },
                native: {}
            });
            await this.setStateAsync(`${folder}.batteryCapacity`, data.batteriesInfo[0].batteryCapacity || 0, true);
        }
    }

    async setupCloudAPI() {
        if (!this.maxxiCcuName) return;

        const infoIntervalMs = 5 * 60 * 1000; // 5min
        const ccuIntervalMs = 30 * 1000;      // 30sec

        this.fetchInfoData();
        this.infoInterval = setInterval(() => this.fetchInfoData(), infoIntervalMs);

        this.fetchCcuData();
        this.ccuInterval = setInterval(() => this.fetchCcuData(), ccuIntervalMs);
    }

    async fetchInfoData() {
        if (!this.maxxiCcuName) return;

        const infoUrl = `http://194.164.194.162:3301/?info=${encodeURIComponent(this.maxxiCcuName)}`;
        try {
            const infoResponse = await axios.get(infoUrl);
            await this.processData(infoResponse.data, "settings", true);
        } catch (error) {
            this.log.error(`Fehler beim Abrufen der Setting-Daten: ${error.message}`);
        }
    }

    async fetchCcuData() {
        if (!this.maxxiCcuName) return;

        const ccuUrl = `http://194.164.194.162:3301/?ccu=${encodeURIComponent(this.maxxiCcuName)}`;
        try {
            const ccuResponse = await axios.get(ccuUrl);
            await this.processData(ccuResponse.data, "systeminfo", true);

            if (ccuResponse.data && ccuResponse.data.deviceId && ccuResponse.data.ip_addr) {
                const deviceFolder = `cloud-${ccuResponse.data.deviceId}`;
                this.updateActiveCCU(deviceFolder);

                if (!this.commandInitialized) {
                    await this.initializeCommandSettings(deviceFolder, ccuResponse.data.ip_addr);
                    this.commandInitialized = true;
                }
            }
        } catch (error) {
            this.log.error(`Fehler beim Abrufen der CCU-Daten: ${error.message}`);
        }
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

			// 1. Datenpunkt ohne min/max erstellen
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

			// 2. Initialwert 0 setzen
			await this.setStateAsync(fullPath, { val: 0, ack: true });

			// 3. min/max hinzufügen
			await this.extendObjectAsync(fullPath, {
				common: {
					min: dp.min,
					max: dp.max,
					states: dp.states || undefined,
					def: dp.default // Kann bei Bedarf weggelassen werden
				}
			});

			// Abonnieren von Änderungen des Datenpunkts
			this.subscribeStates(fullPath);		
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
        if (!state || state.ack) return;

        //this.log.debug(`Zustandsänderung erkannt: ${id} -> ${state.val}`);

        const parts = id.split(".");
        // parts[0] = adapterName (z.B. maxxi-charge)
        // parts[1] = instanz (z.B. 0)
        // parts[2] = cloud-DeviceID oder local-DeviceID
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
                    this.log.info("MaxxiCharge Local API wurde gestoppt");
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
}

if (require.main !== module) {
    module.exports = (options) => new MaxxiCharge(options);
} else {
    new MaxxiCharge();
}
