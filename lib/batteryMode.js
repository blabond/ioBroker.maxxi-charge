'use strict';

const { applySocValue, getActiveDeviceId, changeSettingAkku } = require('./utils');

class BatteryCalibration {
    constructor(adapter) {
        this.adapter = adapter;
    }

    async init() {
        const checkInterval = 5000; // Überprüfungsintervall in Millisekunden
        const maxAttempts = 12; // Maximale Anzahl an Versuchen (z. B. 60 Sekunden insgesamt)

        let attempts = 0;

        const waitForConnection = async () => {
            const connectionState = await this.adapter.getStateAsync(`${this.adapter.namespace}.info.connection`);

            if (connectionState?.val === true) {
                this.adapter.log.debug('Connection is active. Starting battery calibration.');
                clearInterval(this.calibrationCheckInterval);

                const deviceId = await getActiveDeviceId(this.adapter);
                if (deviceId) {
                    await this.handleCalibration(deviceId); // Führe die eigentliche Kalibrierung aus
                }

            } else if (attempts >= maxAttempts) {
                clearInterval(this.calibrationCheckInterval);
                this.adapter.log.debug('Battery calibration process aborted. Connection was not established within the maximum wait time.');
            } else {
                attempts++;
                this.adapter.log.debug('Waiting for connection to become active...');
            }
        };

        this.calibrationCheckInterval = setInterval(waitForConnection, checkInterval);
    }

    async handleCalibration(deviceId) {
        const calibrationProgress = this.adapter.config.calibrationProgress;

        try {
            if (calibrationProgress === "down") {
                this.adapter.log.debug('Battery Calibration Step 1: Setting SOC to 0%.');
                await applySocValue(this.adapter, deviceId, 0, 'minSOC');
                await applySocValue(this.adapter, deviceId, 100, 'maxSOC');
            } else if (calibrationProgress === "up") {
                this.adapter.log.debug('Battery Calibration Step 2: Setting SOC to 100%.');
                await applySocValue(this.adapter, deviceId, 99, 'minSOC');
                await applySocValue(this.adapter, deviceId, 100, 'maxSOC');
            } else {
                this.adapter.log.warn('Invalid calibration progress state. Skipping calibration.');
            }
        } catch (error) {
            this.adapter.log.error(`Error during battery calibration: ${error.message}`);
        }
    }

    async handleCalibrationSOCChange(id, state) {
        if (!state.ack) return;
        const calibrationProgress = this.adapter.config.calibrationProgress;

        if (calibrationProgress === "down" && state.val <= 1) { // "down" Zustand
            await changeSettingAkku(this.adapter, true, "up");
        } else if (calibrationProgress === "up" && state.val >= 99) { // "up" Zustand
            await changeSettingAkku(this.adapter, false, "down");
        }
    }
}

module.exports = BatteryCalibration;
