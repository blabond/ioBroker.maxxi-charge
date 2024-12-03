"use strict";

const utils = require("@iobroker/adapter-core");
const axios = require("axios");

class MaxxiCharge extends utils.Adapter {
    constructor(options) {
        super({
            ...options,
            name: "maxxi-charge",
        });
        this.on("ready", this.onReady.bind(this));
        this.on("unload", this.onUnload.bind(this));
        this.on("stateChange", this.onStateChange.bind(this));

        this.pollingInterval = null;
        this.commandInitialized = false; // Flag für einmalige Initialisierung
    }

    async onReady() {
        // Konfiguration einlesen
        this.maxxiCcuName = this.config.maxxiCcuName;
        this.refreshInterval = this.config.refreshInterval || 5; // Standardwert 5 Minuten
        this.refreshIntervalMs = this.refreshInterval * 60 * 1000; // In Millisekunden umrechnen

       // if (!this.maxxiCcuName) {
            // this.log.error("Maxxi CCU Name ist nicht in der Adapterkonfiguration gesetzt.");
         //   return;
       // }

        // Datenabruf starten
        this.fetchData();
        this.pollingInterval = setInterval(() => this.fetchData(), this.refreshIntervalMs);
    }

    async fetchData() {
        const infoUrl = `http://194.164.194.162:3301/?info=${encodeURIComponent(this.maxxiCcuName)}`;
        const ccuUrl = `http://194.164.194.162:3301/?ccu=${encodeURIComponent(this.maxxiCcuName)}`;

        try {
            // Daten abrufen
            const [infoResponse, ccuResponse] = await Promise.all([
                axios.get(infoUrl),
                axios.get(ccuUrl),
            ]);

            // Daten verarbeiten und in separaten Ordnern speichern
            await this.processData(infoResponse.data, "settings");
            await this.processData(ccuResponse.data, "systeminfo");

            // Einmalige Initialisierung von sendcommand
            if (!this.commandInitialized) {
                await this.initializeCommandSettings(ccuResponse.data.deviceId, ccuResponse.data.ip_addr);
                this.commandInitialized = true;
            }
        } catch (error) {
            this.log.error(`Fehler beim Abrufen der Daten: ${error.message}`);
        }
    }

    async processData(data, baseFolder) {
        let basePath;

        try {
            // Prüfen, ob "deviceId" in den Daten vorhanden ist
            if (data.deviceId) {
                basePath = `${data.deviceId}.${baseFolder}`;
            } else {
                throw new Error("deviceId nicht vorhanden");
            }

            // Wenn alles in Ordnung ist, die Daten verarbeiten
            await this.processNestedData(basePath, data);
        } catch (err) {
            // Fallback: Fehler im "error"-Ordner speichern
            basePath = "error";
            this.log.warn(`Fehler beim Verarbeiten der Daten: ${err.message}`);

            // Fehler-Timestamp setzen
            const timestamp = new Date().toISOString(); // ISO-Format für Datum und Zeit
            await this.ensureStateExists(`${basePath}.Timestamp`, timestamp, "string", "Zeitpunkt des Fehlers");
            await this.setStateAck(`${basePath}.Timestamp`, timestamp);

            // Optional: Den Fehlertext als zusätzlichen State speichern
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

 async initializeCommandSettings(deviceId, ipAddress) {
    if (!deviceId || !ipAddress) {
        this.log.warn("Gerät konnte nicht initialisiert werden. deviceId oder ipAddress fehlt.");
        return;
    }

    const namespace = `${deviceId}.sendcommand`;

    // Datenpunkte erstellen basierend auf dem ursprünglichen Script
    this.commandDatapoints = [
        { id: "maxOutputPower", description: "Maximale CCU Watt-Leistung", type: "number", min: 200, max: 1800, default: 0 },
        { id: "offlinePower", description: "Fallback-Stromabgabe", type: "number", min: 100, max: 600, default: 0 },
        { id: "baseLoad", description: "Stromzähler-Korrektur", type: "number", min: -300, max: 300, default: 0 },
        { id: "threshold", description: "Reaktionstoleranz", type: "number", min: 10, max: 150, default: 0 },
        { id: "minSOC", description: "Minimale Entladung", type: "number", min: 2, max: 90, default: 0 },
        { id: "maxSOC", description: "Maximale Akkuladung", type: "number", min: 30, max: 100, default: 0 },
        { id: "dcAlgorithm", description: "Steuerungsverhalten der CCU", type: "number", states: { 1: "Basic (0.38)", 2: "Forced (0.40+)" }, default: 0 },
    ];

    for (const dp of this.commandDatapoints) {
        const fullPath = `${namespace}.${dp.id}`;
        await this.setObjectNotExistsAsync(fullPath, {
            type: "state",
            common: {
                name: dp.description,
                type: dp.type,
                role: "value",
                min: dp.min,
                max: dp.max,
                states: dp.states || undefined,
                def: dp.default,
                read: true,
                write: true,
            },
            native: {},
        });
        await this.setStateAsync(fullPath, { val: dp.default, ack: true });

        // Änderungen abonnieren
        this.subscribeStates(fullPath);
        this.log.debug(`Datenpunkt abonniert: ${fullPath}`);
    }
}


async onStateChange(id, state) {
    if (!state || state.ack) return;

    this.log.debug(`Zustandsänderung erkannt: ${id} -> ${state.val}`);

    const parts = id.split(".");
    const deviceId = parts[0]; // Der übergeordnete Ordner (maxxiCcuName)
    const datapointId = parts[parts.length - 1]; // Letzter Teil des Pfads ist der Datenpunkt

    const datapoint = this.commandDatapoints.find((dp) => dp.id === datapointId);

    if (!datapoint) {
        this.log.warn(`Unbekannter Datenpunkt: ${id}`);
        return;
    }

    // Validierung und Senden
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

    // Hier prüfen, ob die IP-Adresse korrekt ermittelt wird
    const ipPath = `${this.maxxiCcuName}.systeminfo.ip_addr`;
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
            if (this.pollingInterval) {
                clearInterval(this.pollingInterval);
            }
            callback();
        } catch (e) {
            callback();
        }
    }
}

if (require.main !== module) {
    module.exports = (options) => new MaxxiCharge(options);
} else {
    new MaxxiCharge();
}
