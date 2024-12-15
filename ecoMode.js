'use strict';

const schedule = require('node-schedule');

class EcoMode {
    constructor(adapter) {
        this.adapter = adapter;
        this.deviceFolder = null;
        this.enabled = false;
        this.dateFrom = null;
        this.dateTo = null;
        this.minSoc40SetToday = false;
        this.initialized = false;
        this.dailyJob = null;
    }

    async init() {
        this.enabled = this.adapter.config.regelAktiv;
        if (!this.enabled) return;

        this.dateFrom = this.parseDate(this.adapter.config.dateFrom);
        this.dateTo = this.parseDate(this.adapter.config.dateTo);
        if (!this.dateFrom || !this.dateTo) return;

        this.adapter.subscribeStates('info.connection');

        setTimeout(async () => {
            const connState = await this.adapter.getStateAsync('info.connection');
            const connVal = connState ? connState.val : false;
            if (connVal === true) {
                await this.startMonitoring();
            }
        }, 3000);
    }

    async startMonitoring() {
        if (this.initialized) return;

        const aktivState = await this.adapter.getStateAsync("info.aktivCCU");
        if (!aktivState || !aktivState.val) return;

        const devices = aktivState.val.split(',');
        if (devices.length === 0 || !devices[0]) return;

        this.deviceFolder = devices[0].trim();

        const socDP = `${this.deviceFolder}.systeminfo.SOC`;
        const obj = await this.adapter.getObjectAsync(socDP);
        if (!obj) return;

        this.adapter.subscribeStates(socDP);

        this.scheduleDailyCheck();

        this.initialized = true;
    }

    async onStateChange(id, state) {
        if (id.endsWith('.systeminfo.SOC')) {
            if (!state || state.val === null || typeof state.val !== 'number') return;

            const soc = state.val;
            const today = new Date();
            const td = { day: today.getDate(), month: today.getMonth() + 1 };

            if (this.isInWinterRange(td) && soc >= 55 && !this.minSoc40SetToday) {
                await this.setCommand("minSOC", 40);
                this.minSoc40SetToday = true;
               // this.adapter.log.info("EcoMode: Winterbetrieb - minSOC auf 40 gesetzt, da SOC >= 55.");
            }
        }

        if (id.endsWith('info.connection') && state && state.val === true && !this.initialized) {
            await this.startMonitoring();
        }
    }

    async dailyCheck() {
        const today = new Date();
        const td = { day: today.getDate(), month: today.getMonth() + 1 };

        if (this.isSameDate(td, this.dateTo)) {
            await this.setCommand("minSOC", 10);
            await this.setCommand("maxSOC", 97);
           // this.adapter.log.info("EcoMode: Sommerbetrieb ausgeführt - minSOC=10, maxSOC=97.");
            return;
        }

        if (this.isInWinterRange(td)) {
            await this.setCommand("minSOC", 70);
            this.minSoc40SetToday = false;
        }
    }

    scheduleDailyCheck() {
        const rule = new schedule.RecurrenceRule();
        rule.hour = 8;
        rule.minute = 0;

        this.dailyJob = schedule.scheduleJob(rule, async () => {
            await this.dailyCheck();
        });
    }

    parseDate(str) {
        if (!str || typeof str !== 'string') return null;
        const parts = str.split('.');
        if (parts.length !== 2) return null;

        const day = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10);

        if (isNaN(day) || isNaN(month) || day < 1 || day > 31 || month < 1 || month > 12) {
            return null;
        }

        return { day, month };
    }

    isSameDate(d1, d2) {
        return d1.day === d2.day && d1.month === d2.month;
    }

    isInWinterRange(d) {
        if (!this.dateFrom || !this.dateTo) return false;

        const fromVal = this.dateFrom.month * 100 + this.dateFrom.day;
        const toVal = this.dateTo.month * 100 + this.dateTo.day;
        const curVal = d.month * 100 + d.day;

        if (this.dateFrom.month < this.dateTo.month) {
            return curVal >= fromVal && curVal < toVal;
        } else {
            return curVal >= fromVal || curVal < toVal;
        }
    }

    async setCommand(datapoint, value) {
        if (!this.deviceFolder) return;

        const cmdDP = `${this.deviceFolder}.sendcommand.${datapoint}`;
        await this.adapter.setStateAsync(cmdDP, { val: value, ack: false });
       // this.adapter.log.info(`EcoMode: ${datapoint} auf ${value} gesetzt.`);
    }
}

module.exports = EcoMode;
