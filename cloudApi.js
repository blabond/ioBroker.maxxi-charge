'use strict';
const axios = require('axios');

async function fetchInfoData(adapter) {
    if (!adapter.maxxiCcuName) return;
    const infoUrl = `http://194.164.194.162:3301/?info=${encodeURIComponent(adapter.maxxiCcuName)}`;
    try {
        const infoResponse = await axios.get(infoUrl);
        await adapter.processData(infoResponse.data, "settings", true);
    } catch (error) {
        adapter.log.error(`Fehler beim Abrufen der Setting-Daten: ${error.message}`);
    }
}

async function fetchCcuData(adapter) {
    if (!adapter.maxxiCcuName) return;

    const ccuUrl = `http://194.164.194.162:3301/?ccu=${encodeURIComponent(adapter.maxxiCcuName)}`;
    try {
        const ccuResponse = await axios.get(ccuUrl);
        await adapter.processData(ccuResponse.data, "systeminfo", true);

        if (ccuResponse.data && ccuResponse.data.deviceId && ccuResponse.data.ip_addr) {
            const deviceFolder = `cloud-${ccuResponse.data.deviceId}`;
            adapter.updateActiveCCU(deviceFolder);

            if (!adapter.commandInitialized) {
                await adapter.initializeCommandSettings(deviceFolder, ccuResponse.data.ip_addr);
                adapter.commandInitialized = true;
            }
        }
    } catch (error) {
        adapter.log.error(`Fehler beim Abrufen der CCU-Daten: ${error.message}`);
    }
}

function setupCloudAPI(adapter) {
    if (!adapter.maxxiCcuName) return;

    const infoIntervalMs = 5 * 60 * 1000; // 5min
    const ccuIntervalMs = (adapter.config.ccuInterval || 30) * 1000; // Default 30 Sekunden

    // Hier direkt fetchInfoData und fetchCcuData aufrufen
    fetchInfoData(adapter);
    adapter.infoInterval = setInterval(() => fetchInfoData(adapter), infoIntervalMs);

    fetchCcuData(adapter);
    adapter.ccuInterval = setInterval(() => fetchCcuData(adapter), ccuIntervalMs);
}

module.exports = {
    setupCloudAPI
};
