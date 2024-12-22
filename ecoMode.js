'use strict';

const { getDateValue, applySocValue, validateInterval } = require('./utils');
const schedule = require('node-schedule');

class EcoMode {
    constructor(adapter) {
        this.adapter = adapter;
        this.monitorInterval = null;
        this.ccuintervalMs = 5 * 1000;
        this.minSocSetToday = false;
        this.stateCache = new Set();
        this.winterFrom = null;
        this.winterTo = null;
    }

    async init() {
        if (!this.adapter.config.enableseasonmode) return;

        this.winterFrom = this.parseDate(this.adapter.config.winterfrom);
        this.winterTo = this.parseDate(this.adapter.config.winterto);

        if (!this.winterFrom || !this.winterTo) {
            this.adapter.log.warn('EcoMode: Winter dates not configured properly.');
            return;
        }

        // Warten, bis `info.connection` und `info.aktivCCU` gesetzt sind
        this.adapter.log.debug('EcoMode: Waiting for required states (info.connection, info.aktivCCU)...');
        const connectionState = await this.waitForState('info.connection', 60000); // 60 Sekunden warten
        const aktivCCUState = await this.waitForState('info.aktivCCU', 60000); // 60 Sekunden warten

        if (!connectionState?.val || !aktivCCUState?.val) {
            return;
        }

        // Direkt beim Start einmal prüfen
        await this.evaluateSeason();

        schedule.scheduleJob('0 8 * * *', async () => await this.evaluateSeason());
    }

    async evaluateSeason() {
        const today = { day: new Date().getDate(), month: new Date().getMonth() + 1 };

        if (this.isExactWinterTo(today)) {
            this.adapter.log.debug('EcoMode: Today is the winterTo date. Applying summer mode.');
            await this.applySummerOnce();
            this.cleanup();
            return;
        }

        if (this.isInWinterRange(today)) {
            this.adapter.log.debug('EcoMode: Winter range active. Setting minSOC to 70');
            const aktivState = await this.adapter.getStateAsync('info.aktivCCU');
            if (!aktivState || !aktivState.val) {
                return;
            }
            const deviceId = aktivState.val.split(',')[0].trim();
            await applySocValue(this.adapter, deviceId, 70, 'minSOC');
            await this.startMonitoring();
        } else {
            this.cleanup();
        }
    }

    async startMonitoring() {
        if (this.monitorInterval) return;

        const aktivState = await this.waitForState('info.aktivCCU', 10000);
        if (!aktivState || !aktivState.val) return;

        const deviceId = aktivState.val.split(',')[0].trim();
        const socStatePath = `${this.adapter.namespace}.${deviceId}.SOC`;

        if (!this.stateCache.has(socStatePath)) {
            this.stateCache.add(socStatePath);
            this.adapter.subscribeStates(socStatePath);
        }

        this.minSocSetToday = false;

        const validatedInterval = validateInterval(this.ccuintervalMs, 1000, 3600000); // 1 Sekunde bis 1 Stunde
        this.monitorInterval = this.adapter.setInterval(() => this.checkSocValue(deviceId), validatedInterval);
    }

    async waitForState(stateId, timeoutMs) {
        const startTime = Date.now();

        while (Date.now() - startTime < timeoutMs) {
            const state = await this.adapter.getStateAsync(stateId);
            if (state?.val) {
                return state;
            }
            await new Promise((resolve) => this.adapter.setTimeout(resolve, 500)); // 500 ms warten
        }
        return null;
    }


    async checkSocValue(deviceId) {
        if (this.minSocSetToday) return;

        const socPath = `${this.adapter.namespace}.${deviceId}.SOC`;
        try {
            const state = await this.adapter.getStateAsync(socPath);
            if (!state || typeof state.val !== 'number') return;

            if (state.val >= 55) {
                await applySocValue(this.adapter, deviceId, 40, 'minSOC');
                this.minSocSetToday = true;
                this.cleanup();
            }
        } catch (err) {
            this.adapter.log.error(`EcoMode: Error reading SOC at ${socPath}: ${err.message}`);
        }
    }

    async handleSOCChange(id, state) {
        if (!state || state.ack || typeof state.val !== 'number' || this.minSocSetToday) return;

        if (state.val >= 55) {
            const deviceId = id.split('.')[2];
            await applySocValue(this.adapter, deviceId, 40, 'minSOC');
            this.minSocSetToday = true;
            this.cleanup();
        }
    }

    async applySummerOnce() {
        const aktivState = await this.adapter.getStateAsync('info.aktivCCU');
        if (!aktivState || !aktivState.val) return;

        const deviceId = aktivState.val.split(',')[0].trim();
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
        if (this.monitorInterval) {
            clearInterval(this.monitorInterval);
            this.monitorInterval = null;
        }
        this.minSocSetToday = false;

        this.stateCache.forEach(stateId => {
            this.adapter.unsubscribeStates(stateId);
        });
        this.stateCache.clear();
    }
}

module.exports = EcoMode;
