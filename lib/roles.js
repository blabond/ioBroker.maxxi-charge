'use strict';

// Mapping von bekannten Schlüsseln auf Rollen
const roleMapping = {
    soc: 'value.battery',
    temperature: 'value.temperature',
    voltage: 'value.voltage',
    current: 'value.current',
    power: 'value.power',
    uptime: 'value.time',
    date: 'value.datetime',
    error: 'sensor.alarm',
    isDayTime: 'indicator',
    wifiStrength: 'value.signal', // WLAN-Signalstärke
    firmwareVersion: 'info.firmware', // Firmware-Info
    ip_addr: 'info.ip', // IP-Adresse
    ccuTotalPower: 'value.power', // Gesamtleistung der CCU
    PV_power_total: 'value.power',
    batteryVoltage: 'value.voltage', // Batterie-Spannung
    batteryCurrent: 'value.current', // Batterie-Strom
    batteryPower: 'value.power', // Batterie-Leistung
    batterySOC: 'value.battery', // Batterie-SoC
    ccuTemperature: 'value.temperature', // Temperatur der CCU
    ccuVoltage: 'value.voltage', // CCU-Spannung
    ccuCurrent: 'value.current', // CCU-Strom
    ccuPower: 'value.power', // CCU-Leistung
    microCurve: 'value', // Allgemeiner Wert
    numberOfBatteries: 'value', // Anzahl Batterien
    numberOfConverters: 'value', // Anzahl Umrichter
    serverIp: 'info.ip', // Server-IP-Adresse
    meterIp: 'info.ip', // Zähler-IP-Adresse
    standby_power: 'value.power', // Standby-Leistung
};

/**
 * Bestimmt die Rolle für einen Datenpunkt basierend auf seinem Namen.
 * @param {string} key - Der Name des Datenpunkts.
 * @returns {string} - Die Rolle des Datenpunkts.
 */
function determineRole(key) {
    key = key.toLowerCase(); // Schlüssel in Kleinbuchstaben
    for (const pattern in roleMapping) {
        if (key.includes(pattern)) {
            return roleMapping[pattern];
        }
    }
    return 'state'; // Standardrolle, falls keine Zuordnung gefunden wurde
}

module.exports = { determineRole };
