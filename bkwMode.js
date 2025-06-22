'use strict';

class BkwMode {
    constructor(adapter, commands) {
        this.adapter = adapter;
        this.commands = commands;
        this.lastState = null;
    }

    async handleSOCChange(id, state) {
        if (!state || typeof state.val !== 'number') {
            return;
        }

        // Check preconditions
        if (this.adapter.config.bkw_enable !== true || this.adapter.config.batterycalibration === true) {
            return;
        }

        const soc = state.val;

        // Check connection state
        const connectionState = await this.adapter.getStateAsync(`${this.adapter.namespace}.info.connection`);
        if (!connectionState || connectionState.val !== true) {
            this.adapter.log.debug('bkwMode: Connection is not active. Skipping SOC handling.');
            return;
        }

        const deviceId = this.adapter.config.maxxiccuname ? this.adapter.config.maxxiccuname.toLowerCase() : '';
        let targetValue = null;

        // Only send if change detected
        if (soc >= 97 && this.lastState !== 'high') {
            targetValue = -this.adapter.config.bkw_powerTarget;
            this.lastState = 'high';
        } else if (soc < 97 && this.lastState !== 'low') {
            targetValue = this.adapter.config.bkw_adjustment;
            this.lastState = 'low';
        }

        if (targetValue !== null) {
            let ipAddress;

            if (this.adapter.config.apimode === 'cloud_v2') {
                ipAddress = this.adapter.config.maxxiip;
                if (!ipAddress) {
                    this.adapter.log.debug('bkwMode: No IP address configured for cloud_v2 mode.');
                    return;
                }
            } else {
                const ipPath = `${deviceId}.ip_addr`;
                const ipState = await this.adapter.getStateAsync(ipPath);

                if (!ipState || !ipState.val) {
                    this.adapter.log.debug(
                        `bkwMode: No IP address found for device ${deviceId}. Expected path: ${ipPath}`,
                    );
                    return;
                }

                ipAddress = ipState.val;
            }

            // Send command
            const dummyState = { val: targetValue };
            await this.commands.sendCommandWithRetry(ipAddress, 'baseLoad', dummyState, deviceId);

            this.adapter.log.debug(`bkwMode: baseLoad set to ${targetValue} W (SOC=${soc}%).`);
        }
    }

    cleanup() {
        this.lastState = null;
    }
}

module.exports = BkwMode;
