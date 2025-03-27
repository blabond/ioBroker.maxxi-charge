'use strict';
const axios = require('axios');
const { name2id, processNestedData, validateInterval } = require('./utils');

class CloudApiStable {
    constructor(adapter) {
        this.adapter = adapter;
        this.maxxiccuname = this.adapter.config.maxxiccuname || '';
        this.maxxiemail = this.adapter.config.maxxiemail || '';
        this.ccuintervalMs = (this.adapter.config.ccuinterval || 30) * 1000;
        this.stateCache = new Set();
        this.commandInitialized = false;

        this.jwtToken = null;
        this.infoInterval = null;
        this.ccuInterval = null;
        this.loginRetries = 0;
    }

    async init() {
        if (!this.maxxiccuname || !this.maxxiemail) {
            this.adapter.log.warn('Missing Maxxi CCU name or E-Mail in configuration.');
            return;
        }

        const loginSuccess = await this.login();
        if (!loginSuccess) {
            this.adapter.log.warn('Login to Maxxisun Cloud API failed. Please check your credentials.');
            return;
        }

        this.startFetchingData();
        await this.fetchInfoData();
    }

    async login() {
        try {
            const response = await axios.post(
                'https://maxxisun.app:3000/api/authentication/log-in',
                {
                    email: this.maxxiemail,
                    ccu: this.maxxiccuname,
                },
                {
                    headers: { 'Content-Type': 'application/json' },
                    timeout: 7500,
                },
            );

            if (response.data && response.data.response === true && response.data.jwt) {
                this.jwtToken = response.data.jwt;
                this.loginRetries = 0;

                await this.adapter.setObjectNotExistsAsync('info.jwt', {
                    type: 'state',
                    common: {
                        name: 'JWT Token',
                        type: 'string',
                        role: 'text',
                        read: true,
                        write: false,
                        def: '',
                        desc: 'Stored JWT for Maxxisun Cloud API',
                        custom: {},
                        hidden: true,
                    },
                    native: {},
                });

                await this.adapter.setStateAsync('info.jwt', {
                    val: this.jwtToken,
                    ack: true,
                });

                return true;
            }
        } catch (error) {
            if (error.response && error.response.status === 401) {
                this.adapter.log.warn('Unauthorized: Invalid login credentials for Maxxisun Cloud API.');
            } else {
                this.adapter.log.warn(`Login error: ${error.message}`);
            }
        }
        return false;
    }

    async fetchInfoData(retries = 3) {
        try {
            const response = await axios.get('https://maxxisun.app:3000/api/config', {
                headers: {
                    Authorization: `Bearer ${this.jwtToken}`,
                },
                timeout: 7500,
            });

            const deviceId = name2id(this.maxxiccuname);
            const basePath = `${deviceId}.settings`;

            const payload = response.data?.data;
            if (payload) {
                await processNestedData(this.adapter, basePath, payload, this.stateCache);
            } else {
                this.adapter.log.warn('No "data" field found in /api/config response');
            }
        } catch (error) {
            if (error.response && error.response.status === 401 && this.loginRetries < 2) {
                this.loginRetries++;
                this.adapter.log.debug(`JWT expired. Re-authenticating... (${this.loginRetries}/2)`);
                const loginSuccess = await this.login();
                if (loginSuccess) {
                    return this.fetchInfoData();
                }
            } else if (retries > 0) {
                this.adapter.log.debug(`Retrying fetchInfoData due to error: ${error.message}`);
                await new Promise(resolve => setTimeout(resolve, 2000));
                return this.fetchInfoData(retries - 1);
            }
            this.adapter.log.info(`Error fetching config data: ${error.message}`);
        }
    }

    async fetchCcuData() {
        try {
            const response = await axios.get('https://maxxisun.app:3000/api/last', {
                headers: {
                    Authorization: `Bearer ${this.jwtToken}`,
                },
                timeout: 7500,
            });

            const deviceId = name2id(this.maxxiccuname).toLowerCase();
            const basePath = `${deviceId}`;

            const payload = response.data;
            if (payload && payload.convertersInfo) {
                delete payload.convertersInfo;
            }

            await processNestedData(this.adapter, basePath, payload, this.stateCache);

            if (!this.commandInitialized) {
                await this.adapter.commands.initializeCommandSettings(deviceId);
                this.commandInitialized = true;
            }

            await this.adapter.updateActiveCCU(deviceId);
        } catch (error) {
            if (error.response && error.response.status === 401 && this.loginRetries < 2) {
                this.loginRetries++;
                this.adapter.log.debug(`JWT expired. Re-authenticating... (${this.loginRetries}/2)`);
                const loginSuccess = await this.login();
                if (loginSuccess) {
                    return this.fetchCcuData();
                }
            }
            this.adapter.log.info(`Error fetching last data: ${error.message}`);
        }
    }

    startFetchingData() {
        const infoInterval = validateInterval(5 * 60 * 1000, 180000, 3600000);
        const ccuInterval = validateInterval(this.ccuintervalMs, 10000, 3600000);

        const randomOffset = Math.floor(Math.random() * infoInterval);

        setTimeout(() => {
            this.infoInterval = this.adapter.setInterval(() => {
                void this.fetchInfoData();
            }, infoInterval);
        }, randomOffset);

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

module.exports = CloudApiStable;
