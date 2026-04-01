"use strict";

const { name2id, ensureStateExists } = require("./utils");
const axios = require("axios");

class Commands {
  constructor(adapter) {
    this.adapter = adapter;
    this.stateCache = new Set(); // Cache für bestehende States
    this.initializedDevices = new Set(); // Keep track of devices with subscribed states
    this.refreshedNamespaces = new Set(); // Track sendcommand namespaces refreshed after adapter start
    this.commandDatapoints = [
      {
        id: "maxOutputPower",
        description: {
          en: "Micro-inverter maximum power (W)",
          de: "Mikrowechselrichter maximale Leistung (W)",
        },
        type: "number",
        min: 300,
        max: 2300,
        role: "level",
      },
      {
        id: "offlinePower",
        description: {
          en: "Offline output power (W)",
          de: "Offline-Ausgangsleistung (W)",
        },
        type: "number",
        min: 50,
        max: 600,
        role: "level",
      },
      {
        id: "baseLoad",
        description: { en: "Adjust output (W)", de: "Ausgabe anpassen (W)" },
        type: "number",
        min: -600,
        max: 600,
        role: "level",
      },
      {
        id: "offlineOutput",
        description: {
          en: "Offline output (W)",
          de: "Offline-Ausgang (W)",
        },
        type: "number",
        min: 50,
        max: 600,
        role: "level",
      },
      {
        id: "threshold",
        description: {
          en: "Response tolerance (W)",
          de: "Reaktionstoleranz (W)",
        },
        type: "number",
        min: 3,
        max: 50,
        role: "level",
      },
      {
        id: "minSOC",
        description: {
          en: "Minimum battery discharge",
          de: "Minimale Batterieentladung",
        },
        type: "number",
        min: 0,
        max: 99,
        role: "level.min",
      },
      {
        id: "maxSOC",
        description: {
          en: "Maximum battery discharge",
          de: "Maximale Batterieentladung",
        },
        type: "number",
        min: 20,
        max: 100,
        role: "level.max",
      },
      {
        id: "autoCalibration",
        description: {
          en: "Auto calibration",
          de: "Automatische Kalibrierung",
        },
        type: "number",
        states: { 0: "Off", 1: "On" },
        role: "level",
      },
    ];
  }

  async initializeCommandSettings(deviceId) {
    const namespace = `${name2id(deviceId)}.sendcommand`;

    await this.refreshCommandNamespace(namespace);

    // Remember which devices have command datapoints initialized
    this.initializedDevices.add(name2id(deviceId));

    for (const dp of this.commandDatapoints) {
      const fullPath = `${namespace}.${dp.id}`;

      // Datenpunkt initialisieren (falls nicht existiert)
      await ensureStateExists(this.adapter, this.stateCache, fullPath, {
        type: "state",
        common: {
          name: dp.description,
          type: dp.type,
          role: dp.role || "value",
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

  async refreshCommandNamespace(namespace) {
    if (this.refreshedNamespaces.has(namespace)) {
      return;
    }

    const existingNamespace = await this.adapter.getObjectAsync(namespace);
    if (existingNamespace) {
      this.adapter.unsubscribeStates(`${namespace}.*`);
      await this.adapter.delObjectAsync(namespace, { recursive: true });

      for (const cachedPath of [...this.stateCache]) {
        if (
          cachedPath === namespace ||
          cachedPath.startsWith(`${namespace}.`)
        ) {
          this.stateCache.delete(cachedPath);
        }
      }
    }

    this.refreshedNamespaces.add(namespace);
  }

  async handleCommandChange(id, state) {
    if (!state || state.ack) {
      return;
    }

    const parts = id.split(".");
    const deviceId = name2id(parts[2]);
    const datapointId = parts[parts.length - 1];

    const commandDatapoint = this.commandDatapoints.find(
      (dp) => dp.id === datapointId,
    );
    if (!commandDatapoint) {
      this.adapter.log.warn(`Unknown command datapoint: ${id}`);
      return;
    }

    if (
      commandDatapoint.min !== undefined &&
      state.val < commandDatapoint.min
    ) {
      this.adapter.log.warn(
        `Value for ${datapointId} is too small. Minimum: ${commandDatapoint.min}`,
      );
      await this.adapter.setStateAsync(id, {
        val: commandDatapoint.min,
        ack: true,
      });
      return;
    }

    if (
      commandDatapoint.max !== undefined &&
      state.val > commandDatapoint.max
    ) {
      this.adapter.log.warn(
        `Value for ${datapointId} is too large. Maximum: ${commandDatapoint.max}`,
      );
      await this.adapter.setStateAsync(id, {
        val: commandDatapoint.max,
        ack: true,
      });
      return;
    }

    let ipAddress;

    const ipPath = `${deviceId}.ip_addr`;
    const ipState = await this.adapter.getStateAsync(ipPath);

    if (!ipState || !ipState.val) {
      this.adapter.log.error(
        `No IP address found for device ${deviceId}. Expected path: ${ipPath}`,
      );
      return;
    }

    ipAddress = ipState.val;

    await this.sendCommandWithRetry(ipAddress, datapointId, state, deviceId);
  }

  async sendCommandWithRetry(
    ipAddress,
    datapointId,
    state,
    deviceId,
    retryCount = 1,
  ) {
    const url = `http://${ipAddress}/config`;
    const payload = `${datapointId}=${state.val}`;

    for (let attempt = 1; attempt <= retryCount + 1; attempt++) {
      try {
        await axios.post(url, payload, {
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          timeout: 15000,
        });

        this.adapter.log.debug(
          `Command ${datapointId} successfully sent to device ${deviceId}: ${state.val}`,
        );
        return;
      } catch (error) {
        if (attempt <= retryCount) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        } else {
          this.adapter.log.error(
            `Error sending command ${datapointId} to device ${deviceId}: ${error.message}`,
          );
        }
      }
    }
  }

  cleanup() {
    // Entfernt alle Abonnements für Zustandsänderungen
    // Unsubscribe from all previously subscribed states
    this.initializedDevices.forEach((deviceId) => {
      this.commandDatapoints.forEach((dp) => {
        const fullPath = `${deviceId}.sendcommand.${dp.id}`;
        this.adapter.unsubscribeStates(fullPath);
      });
    });

    // Clear the list of initialized devices
    this.initializedDevices.clear();
    this.refreshedNamespaces.clear();

    // Leert den State-Cache
    this.stateCache.clear();
  }
}

module.exports = Commands;
