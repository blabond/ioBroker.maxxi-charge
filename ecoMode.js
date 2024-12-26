'use strict';

const { getDateValue, applySocValue, getActiveDeviceId } = require('./utils');
const schedule = require('node-schedule');

class EcoMode {
    constructor(adapter) {
        this.adapter = adapter;
        this.minSocSetToday = false;
        this.winterFrom = null;
        this.winterTo = null;
    }

    async init() {
        if (!this.adapter.config.enableseasonmode) {
            this.adapter.log.debug('EcoMode: Season mode is disabled.');
            return;
        }

        this.winterFrom = this.parseDate(this.adapter.config.winterfrom);
        this.winterTo = this.parseDate(this.adapter.config.winterto);

        if (!this.winterFrom || !this.winterTo) {
            this.adapter.log.warn('EcoMode: Winter dates not configured properly. Initialization aborted.');
            return;
        }

        this.adapter.subscribeStates(`${this.adapter.namespace}.info.connection`);
    }

    async startMonitoring() {
        const checkInterval = 5000; // Wartezeit in Millisekunden zwischen den Überprüfungen
        const maxAttempts = 12; // Maximale Anzahl der Überprüfungen (z.B. 60 Sekunden insgesamt)

        let attempts = 0;

        const waitForDevice = async () => {
            const deviceId = await getActiveDeviceId(this.adapter);

            if (deviceId) {
                this.adapter.log.debug(`EcoMode: Active device found: ${deviceId}. Starting evaluation.`);
                clearInterval(this.deviceCheckInterval); // Stoppe die Überprüfung

                // Starte die erste Überprüfung sofort
                await this.evaluateSeason();

                // CronJob für die tägliche Überprüfung um 8 Uhr
                schedule.scheduleJob('0 8 * * *', async () => {
                    await this.evaluateSeason();
                });

            } else if (attempts >= maxAttempts) {
                clearInterval(this.deviceCheckInterval); // Stoppe die Überprüfung
            } else {
                attempts++;
                this.adapter.log.debug('EcoMode: No active device found yet. Retrying...');
            }
        };

        // Intervall starten, um auf ein aktives Gerät zu warten
        this.deviceCheckInterval = setInterval(waitForDevice, checkInterval);
    }



    async evaluateSeason() {
        const today = { day: new Date().getDate(), month: new Date().getMonth() + 1 };

        // Überprüfen, ob ein aktives Gerät existiert
        const deviceId = await getActiveDeviceId(this.adapter);
        if (!deviceId) {
            this.adapter.log.debug('EcoMode: No active device found. Skipping evaluation.');
            return;
        }

        if (this.isExactWinterTo(today)) {
            this.adapter.log.debug('EcoMode: Today is the winterTo date. Applying summer mode.');
            await this.applySummerOnce(deviceId);
            this.cleanup();
            return;
        }

        if (this.isInWinterRange(today)) {
            this.adapter.log.debug('EcoMode: Winter range active. Setting minSOC to 70');
            await applySocValue(this.adapter, deviceId, 70, 'minSOC');
        } else {
            this.cleanup();
        }
    }

    async handleSOCChange(id, state) {
        if (!state || typeof state.val !== 'number' || this.minSocSetToday) return;

        const parts = id.split('.');
        const deviceId = parts.length > 2 ? parts[2] : null;

        if (!deviceId) {
            this.adapter.log.error(`Invalid state ID: ${id}. Unable to extract deviceId.`);
            return;
        }

        if (state.val >= 55) {
            await applySocValue(this.adapter, deviceId, 40, 'minSOC');
            this.minSocSetToday = true;
            this.cleanup();
        }
    }

    async applySummerOnce(deviceId) {
        if (!deviceId) {
            this.adapter.log.warn('EcoMode: No active deviceId found for summer mode application.');
            return;
        }

        await applySocValue(this.adapter, deviceId, 10, 'minSOC');
        await applySocValue(this.adapter, deviceId, 97, 'maxSOC');
    }

    isInWinterRange(dateObj) {
        const fromVal = getDateValue(this.winterFrom);
        const toVal = getDateValue(this.winterTo);
        const nowVal = getDateValue(dateObj);

        if (fromVal < toVal) {
            return nowVal >= fromVal && nowVal < toVal;
        } else {
            return nowVal >= fromVal || nowVal < toVal;
        }
    }

    isExactWinterTo(dateObj) {
        return getDateValue(dateObj) === getDateValue(this.winterTo);
    }

    parseDate(str) {
        if (!str || typeof str !== 'string') return null;
        const [d, m] = str.split('.').map(Number);
        return (d >= 1 && d <= 31 && m >= 1 && m <= 12) ? { day: d, month: m } : null;
    }

    cleanup() {
        this.minSocSetToday = false;

        // Entfernen von geplanten Jobs
        const jobs = schedule.scheduledJobs;
        for (const jobName in jobs) {
            jobs[jobName].cancel();
        }
    }
}

module.exports = EcoMode;
