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

        // Täglicher CronJob um 8 Uhr
        schedule.scheduleJob('0 8 * * *', async () => {
            await this.evaluateSeason();
        });

        const waitForDevice = async () => {
            const deviceId = await getActiveDeviceId(this.adapter);

            if (deviceId) {
                this.adapter.log.debug(`EcoMode: Active device found: ${deviceId}. Starting immediate evaluation.`);
                clearInterval(this.deviceCheckInterval); // Stoppe die Überprüfung
                await this.evaluateSeason(); // Sofortige Überprüfung
            } else if (attempts >= maxAttempts) {
                this.adapter.log.warn(
                    'EcoMode: No active device found after maximum attempts. Monitoring will still continue with daily checks.',
                );
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
        const feedInMode = this.adapter.config.feedInMode;

        // Überprüfen, ob ein aktives Gerät existiert
        const deviceId = await getActiveDeviceId(this.adapter);
        if (!deviceId) {
            this.adapter.log.debug('EcoMode: No active device found. Skipping evaluation.');
            return;
        }

        if (this.isExactWinterTo(today)) {
            this.adapter.log.debug('EcoMode: Today is the Winter end date. Applying summer mode.');
            await this.applySummerOnce(deviceId);
            this.minSocSetToday = true;
            return;
        }

        if (this.isInWinterRange(today)) {
            this.adapter.log.debug('EcoMode: Winter range active. Setting minSOC to 60.');
            await applySocValue(this.adapter, deviceId, 60, 'minSOC');
            await applySocValue(this.adapter, deviceId, feedInMode, 'maxSOC');
            this.minSocSetToday = false;
        } else {
            if (this.adapter.config.batterycalibration === true) {
                this.adapter.log.debug('EcoMode: Battery Calibration aktiv. No action required.');
            } else {
                this.adapter.log.debug('EcoMode: Summer range active.');
                await applySocValue(this.adapter, deviceId, 10, 'minSOC');
                await applySocValue(this.adapter, deviceId, feedInMode, 'maxSOC');
            }

            this.minSocSetToday = true;
        }
    }

    async handleSOCChange(id, state) {
        if (!state || !state.ack || typeof state.val !== 'number' || this.minSocSetToday) {
            return;
        }

        const parts = id.split('.');
        const deviceId = parts.length > 2 ? parts[2] : null;

        if (!deviceId) {
            this.adapter.log.error(`Invalid state ID: ${id}. Unable to extract deviceId.`);
            return;
        }

        // Abfrage, ob Winter- oder Sommermodus definiert wurde
        const today = { day: new Date().getDate(), month: new Date().getMonth() + 1 };
        if (!this.isInWinterRange(today) && !this.isExactWinterTo(today)) {
            return;
        }

        if (this.adapter.config.enableseasonmode && state.val >= 55 && !this.adapter.config.batterycalibration) {
            await applySocValue(this.adapter, deviceId, 40, 'minSOC');
            this.minSocSetToday = true;
        }
    }

    async applySummerOnce(deviceId) {
        const feedInMode = this.adapter.config.feedInMode;
        if (!deviceId) {
            this.adapter.log.warn('EcoMode: No active deviceId found for summer mode application.');
            return;
        }

        await applySocValue(this.adapter, deviceId, 10, 'minSOC');
        await applySocValue(this.adapter, deviceId, feedInMode, 'maxSOC');
    }

    isInWinterRange(dateObj) {
        const fromVal = getDateValue(this.winterFrom);
        const toVal = getDateValue(this.winterTo);
        const nowVal = getDateValue(dateObj);

        if (fromVal < toVal) {
            return nowVal >= fromVal && nowVal < toVal; // toVal ist exklusiv
        }
        return (nowVal >= fromVal || nowVal < toVal) && nowVal !== toVal; // toVal explizit ausgeschlossen
    }

    isExactWinterTo(dateObj) {
        return getDateValue(dateObj) === getDateValue(this.winterTo);
    }

    parseDate(str) {
        if (!str || typeof str !== 'string') {
            return null;
        }
        const [d, m] = str.split('.').map(Number);
        return d >= 1 && d <= 31 && m >= 1 && m <= 12 ? { day: d, month: m } : null;
    }

    cleanup() {
        this.minSocSetToday = false;

        // Entfernen von geplanten Jobs
        const jobs = schedule.scheduledJobs;
        if (jobs && typeof jobs === 'object') {
            for (const jobName in jobs) {
                if (Object.prototype.hasOwnProperty.call(jobs, jobName)) {
                    jobs[jobName].cancel();
                }
            }
        }

        // Entfernen des Intervalls
        if (this.deviceCheckInterval) {
            clearInterval(this.deviceCheckInterval);
        }
    }
}

module.exports = EcoMode;
