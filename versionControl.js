'use strict';
const axios = require('axios');
const { validateInterval } = require('./utils');

class VersionControlFetcher {
    constructor(adapter) {
        this.adapter = adapter;
        this.jwtToken = null;
        this.interval = null;
        this.lastChangeTimestamp = 0;
    }

    async init() {
        const mode = this.adapter.config.apimode;

        if (mode === 'cloud_v2') {
            const jwtState = await this.adapter.getStateAsync('info.jwt');
            if (jwtState?.val) {
                this.jwtToken = jwtState.val;
            } else {
                const loginSuccess = await this.login();
                if (!loginSuccess) {
                    return;
                }
            }
        } else if (mode === 'cloud' || mode === 'local') {
            if (!this.adapter.config.email || !this.adapter.config.maxxiccuname) {
                return;
            }

            const jwtState = await this.adapter.getStateAsync('info.jwt');
            if (jwtState?.val) {
                this.jwtToken = jwtState.val;
            } else {
                const loginSuccess = await this.login();
                if (!loginSuccess) {
                    return;
                }
            }
        } else {
            return;
        }

        await this.clearVersionStates();
        await this.fetchVersions();

        const refreshInterval = validateInterval(6 * 60 * 60 * 1000, 300000, 24 * 60 * 60 * 1000);
        this.interval = this.adapter.setInterval(() => this.fetchVersions(), refreshInterval);

        this.adapter.subscribeStates('*VersionControl.Releases*');
        this.adapter.subscribeStates('*VersionControl.Experimentell*');
    }

    async login() {
        try {
            const response = await axios.post(
                'https://maxxisun.app:3000/api/authentication/log-in',
                {
                    email: this.adapter.config.email,
                    ccu: this.adapter.config.maxxiccuname,
                },
                {
                    headers: { 'Content-Type': 'application/json' },
                    timeout: 7500,
                },
            );

            if (response.data?.jwt) {
                this.jwtToken = response.data.jwt;

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
            if (error.response?.status === 401) {
                return false;
            }
        }
        return false;
    }

    async clearVersionStates() {
        const deviceId = this.adapter.config.maxxiccuname ? this.adapter.config.maxxiccuname.toLowerCase() : 'default';
        const basePath = `${deviceId}.VersionControl`;
        const existingStates = await this.adapter.getStatesAsync(`${basePath}.*`);

        for (const fullId of Object.keys(existingStates)) {
            await this.adapter.delObjectAsync(fullId);
        }
    }

    async fetchVersions(retries = 1) {
        try {
            const response = await axios.get('https://maxxisun.app:3000/api/versions', {
                headers: {
                    Authorization: `Bearer ${this.jwtToken}`,
                },
                timeout: 7500,
            });

            const allVersions = response.data?.data?.versions;
            if (!allVersions?.length) {
                return;
            }

            const deviceId = this.adapter.config.maxxiccuname
                ? this.adapter.config.maxxiccuname.toLowerCase()
                : 'default';
            const basePath = `${deviceId}.VersionControl`;

            await this.adapter.setObjectNotExistsAsync(basePath, {
                type: 'folder',
                common: { name: 'Firmware Version Info' },
                native: {},
            });

            const categories = {
                Releases: [],
                'Experimentell not for Use': [],
            };

            for (const v of allVersions) {
                if (v.current === true) {
                    categories.Releases.push(v);
                } else if (v.beta === false && v.visible === true) {
                    categories.Releases.push(v);
                } else {
                    categories['Experimentell not for Use'].push(v);
                }
            }

            const nameMap = {
                Releases: 'Releases',
                'Experimentell not for Use': 'Experimentell',
            };

            for (const [category, versions] of Object.entries(categories)) {
                const name = nameMap[category] || category;
                const catPath = `${basePath}.${category}`;

                await this.adapter.setObjectNotExistsAsync(catPath, {
                    type: 'channel',
                    common: { name },
                    native: {},
                });

                for (const version of versions) {
                    let versionLabel = `Version -${String(version.version)}-`;
                    if (version.current === true) {
                        versionLabel += ' Stable';
                    }

                    const versionId = versionLabel.replace(/\./g, '_');
                    const id = `${catPath}.${versionId}`;

                    await this.adapter.setObjectNotExistsAsync(id, {
                        type: 'state',
                        common: {
                            name: version.message,
                            type: 'boolean',
                            role: 'switch',
                            read: true,
                            write: true,
                            def: false,
                        },
                        native: {},
                    });

                    await this.adapter.setStateAsync(id, {
                        val: false,
                        ack: true,
                    });
                }
            }
        } catch (error) {
            if (error.response?.status === 401 && this.adapter.config.apimode !== 'cloud_v2' && retries > 0) {
                const loginSuccess = await this.login();
                if (loginSuccess) {
                    return this.fetchVersions(retries - 1);
                }
            }
        }
    }

    async handleStateChange(id, state) {
        if (!state || state.ack || state.val !== true) {
            return;
        }

        const now = Date.now();
        const waitMs = 5 * 60 * 1000;
        const timeRemaining = this.lastChangeTimestamp + waitMs - now;

        if (timeRemaining > 0) {
            const seconds = Math.ceil(timeRemaining / 1000);
            const roundedMinutes = Math.ceil(seconds / 60);
            this.adapter.log.warn(
                `Version change too frequent. Please wait ${roundedMinutes} minute(s) before sending again.`,
            );
            await this.adapter.setStateAsync(id, { val: false, ack: true });
            return;
        }

        this.lastChangeTimestamp = now;

        const match = id.match(/Version -(.+?)-/);
        if (!match) {
            return;
        }

        const versionNumber = match[1].replace('_', '.');
        const payload = { version: parseFloat(versionNumber) };

        try {
            const response = await axios.put('https://maxxisun.app:3000/api/version', payload, {
                headers: {
                    Authorization: `Bearer ${this.jwtToken}`,
                    'Content-Type': 'application/json',
                },
                timeout: 7500,
            });

            if (response.data?.response === true && response.data?.version) {
                this.adapter.log.info(`Version change successfully initiated to version ${response.data.version}`);
                if (this.adapter.config.apimode === 'local') {
                    this.adapter.log.info(
                        'Note: Local mode is active. Please switch to cloud mode manually to perform the update.',
                    );
                }
                setTimeout(() => {
                    void this.adapter.setStateAsync(id, { val: false, ack: true });
                }, 5000);
            } else {
                this.adapter.log.warn(`Version change failed.`);
                await this.adapter.setStateAsync(id, { val: false, ack: true });
            }
        } catch (error) {
            this.adapter.log.warn(`Failed to send version change: ${error.message}`);
            await this.adapter.setStateAsync(id, { val: false, ack: true });
        }
    }

    cleanup() {
        if (this.interval) {
            clearInterval(this.interval);
        }
    }
}

module.exports = VersionControlFetcher;
