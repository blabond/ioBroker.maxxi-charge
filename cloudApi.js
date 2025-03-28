'use strict';
const axios = require('axios');
const { name2id, processNestedData, validateInterval } = require('./utils');

class CloudApi {
    constructor(adapter) {
        this.adapter = adapter;
        this.maxxiccuname = this.adapter.config.maxxiccuname || ''; // Direkt aus der Konfiguration
        this.ccuintervalMs = (this.adapter.config.ccuinterval || 30) * 1000;
        this.stateCache = new Set(); // Cache für bestehende States
        this.commandInitialized = false;

        // Intervalle definieren
        this.infoInterval = null;
        this.ccuInterval = null;
    }

    async init() {
        if (!this.maxxiccuname) {
            this.adapter.log.warn('No CCU name configured for Cloud API.');
            return;
        }

        this.startFetchingData();
    }

    async fetchInfoData(retries = 3) {
        const infoUrl = `http://maxxicharge.mr-bond.de:3301/?info=${encodeURIComponent(this.maxxiccuname)}`;
        try {
            const response = await axios.get(infoUrl, { timeout: 7500 });
            const deviceId = name2id(response.data.deviceId);
            const basePath = `${deviceId}.settings`;

            await processNestedData(this.adapter, basePath, response.data, this.stateCache);
        } catch (error) {
            if (retries > 0) {
                this.adapter.log.debug(`Retrying fetchInfoData due to error: ${error.message}`);
                await new Promise(resolve => setTimeout(resolve, 2000)); // 2s Delay
                return this.fetchInfoData(retries - 1);
            }
            this.adapter.log.debug(`V1: Error fetching Info data: ${error.message}`);
        }
    }

    async fetchCcuData(retries = 3) {
        const ccuUrl = `http://maxxicharge.mr-bond.de:3301/?ccu=${encodeURIComponent(this.maxxiccuname)}`;
        try {
            const response = await axios.get(ccuUrl, { timeout: 7500 });
            const rawDeviceId = response.data.deviceId;
            const deviceId = name2id(rawDeviceId).toLowerCase();
            const basePath = `${deviceId}`;

            await processNestedData(this.adapter, basePath, response.data, this.stateCache);

            if (!this.commandInitialized) {
                await this.adapter.commands.initializeCommandSettings(deviceId);
                this.commandInitialized = true;
            }

            await this.adapter.updateActiveCCU(deviceId);
        } catch (error) {
            if (retries > 0) {
                this.adapter.log.debug(`Retrying fetchCcuData due to error: ${error.message}`);
                await new Promise(resolve => setTimeout(resolve, 2000));
                return this.fetchCcuData(retries - 1);
            }
            this.adapter.log.debug(`V1: Error fetching CCU data: ${error.message}`);
        }
    }

    startFetchingData() {
        const infoInterval = validateInterval(5 * 60 * 1000, 180000, 3600000);
        const ccuInterval = validateInterval(this.ccuintervalMs, 10000, 3600000);

        // ZUFÄLLIGE Verzögerung für Info-Request
        const randomOffset = Math.floor(Math.random() * infoInterval); // 0 - 5 Min

        // Erst nach Zufallszeit starten
        setTimeout(() => {
            void this.fetchInfoData();

            // Danach im fixen 5-Minuten-Takt
            this.infoInterval = this.adapter.setInterval(() => {
                void this.fetchInfoData();
            }, infoInterval);
        }, randomOffset);

        // CCU bleibt wie gehabt mit 1,5 Sek Verzögerung
        setTimeout(() => {
            void this.fetchCcuData();
            this.ccuInterval = this.adapter.setInterval(() => {
                void this.fetchCcuData();
            }, ccuInterval);
        }, 1500);
    }

    cleanup() {
        if (this.infoInterval) {
            clearInterval(this.infoInterval);
        }

        if (this.ccuInterval) {
            clearInterval(this.ccuInterval);
        }
    }
}

module.exports = CloudApi;
