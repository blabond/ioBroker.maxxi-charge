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

    async fetchInfoData() {
        const infoUrl = `http://maxxicharge.mr-bond.de:3301/?info=${encodeURIComponent(this.maxxiccuname)}`;
        try {
            const response = await axios.get(infoUrl, { timeout: 7500 }); // Timeout von 7,5 Sekunden
            const deviceId = name2id(response.data.deviceId);
            const basePath = `${deviceId}.settings`;

            await processNestedData(this.adapter, basePath, response.data, this.stateCache);
        } catch (error) {
            this.adapter.log.info(`Error fetching Settings data: ${error.message}`);
        }
    }

    async fetchCcuData() {
        const ccuUrl = `http://maxxicharge.mr-bond.de:3301/?ccu=${encodeURIComponent(this.maxxiccuname)}`;
        try {
            const response = await axios.get(ccuUrl, { timeout: 7500 }); // Timeout von 7,5 Sekunden
            const rawDeviceId = response.data.deviceId; // Original erhalten
            const deviceId = name2id(rawDeviceId).toLowerCase();
            const basePath = `${deviceId}`;

            await processNestedData(this.adapter, basePath, response.data, this.stateCache);

            if (!this.commandInitialized) {
                await this.adapter.commands.initializeCommandSettings(deviceId);
                this.commandInitialized = true;
            }

            await this.adapter.updateActiveCCU(deviceId);
        } catch (error) {
            this.adapter.log.info(`Error fetching CCU data: ${error.message}`);
        }
    }

    startFetchingData() {
        const infoInterval = validateInterval(5 * 60 * 1000, 180000, 3600000);
        const ccuInterval = validateInterval(this.ccuintervalMs, 10000, 3600000);

        // Direkt starten + Intervall für Info
        void this.fetchInfoData();
        this.infoInterval = this.adapter.setInterval(() => {
            void this.fetchInfoData();
        }, infoInterval);

        // Direkt starten + 1,5 Sekunden Delay für CCU
        setTimeout(() => {
            void this.fetchCcuData();
            // Intervall erst danach starten
            this.ccuInterval = this.adapter.setInterval(() => {
                void this.fetchCcuData();
            }, ccuInterval);
        }, 1500); // 1,5 Sekunden Delay
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
