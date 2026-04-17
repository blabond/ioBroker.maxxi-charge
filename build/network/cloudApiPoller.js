"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const constants_1 = require("../constants");
const helpers_1 = require("../utils/helpers");
class CloudApiPoller {
    adapter;
    config;
    scheduler;
    stateManager;
    deviceRegistry;
    requestClient;
    onDeviceSeen;
    infoIntervalHandle = null;
    ccuIntervalHandle = null;
    infoStartHandle = null;
    ccuStartHandle = null;
    infoRequestInFlight = false;
    ccuRequestInFlight = false;
    started = false;
    failureLogStateByKey = new Map();
    constructor(adapter, config, scheduler, stateManager, deviceRegistry, requestClient, onDeviceSeen) {
        this.adapter = adapter;
        this.config = config;
        this.scheduler = scheduler;
        this.stateManager = stateManager;
        this.deviceRegistry = deviceRegistry;
        this.requestClient = requestClient;
        this.onDeviceSeen = onDeviceSeen;
    }
    start() {
        if (this.started) {
            return Promise.resolve();
        }
        if (!this.config.ccuName) {
            this.adapter.log.warn('Cloud API mode is enabled but no CCU name is configured.');
            return Promise.resolve();
        }
        this.started = true;
        const infoStartDelay = Math.floor(Math.random() * constants_1.CLOUD_INFO_INTERVAL_MS);
        this.infoStartHandle = this.scheduler.setTimeout(async () => {
            await this.pollInfo();
            this.infoIntervalHandle = this.scheduler.setInterval(async () => {
                await this.pollInfo();
            }, constants_1.CLOUD_INFO_INTERVAL_MS, 'cloud-info-poll');
        }, infoStartDelay, 'cloud-info-start');
        this.ccuStartHandle = this.scheduler.setTimeout(async () => {
            await this.pollCcu();
            this.ccuIntervalHandle = this.scheduler.setInterval(async () => {
                await this.pollCcu();
            }, this.config.ccuIntervalMs, 'cloud-ccu-poll');
        }, constants_1.CLOUD_CCU_INITIAL_DELAY_MS, 'cloud-ccu-start');
        return Promise.resolve();
    }
    dispose() {
        this.started = false;
        this.scheduler.clearTimeout(this.infoStartHandle);
        this.scheduler.clearTimeout(this.ccuStartHandle);
        this.scheduler.clearInterval(this.infoIntervalHandle);
        this.scheduler.clearInterval(this.ccuIntervalHandle);
        this.infoStartHandle = null;
        this.ccuStartHandle = null;
        this.infoIntervalHandle = null;
        this.ccuIntervalHandle = null;
        this.infoRequestInFlight = false;
        this.ccuRequestInFlight = false;
        this.failureLogStateByKey.clear();
        return Promise.resolve();
    }
    async pollInfo() {
        if (!this.started) {
            return;
        }
        if (this.infoRequestInFlight) {
            this.adapter.log.debug('Cloud API info polling skipped because a request is still in flight.');
            return;
        }
        this.infoRequestInFlight = true;
        try {
            const payload = await this.fetchWithRetry('info', async () => {
                const response = await this.requestClient.get(`${constants_1.CLOUD_API_BASE_URL}?info=${encodeURIComponent(this.config.ccuName)}`, {
                    timeoutMs: constants_1.REQUEST_TIMEOUT_MS,
                    label: `Cloud info request for ${this.config.ccuName}`,
                });
                return response.data;
            });
            if (!(0, helpers_1.isRecord)(payload) || !this.started) {
                return;
            }
            const deviceId = typeof payload.deviceId === 'string' ? (0, helpers_1.normalizeDeviceId)(payload.deviceId) : '';
            if (!deviceId) {
                this.adapter.log.warn('Cloud API info response does not contain a valid deviceId.');
                return;
            }
            await this.stateManager.syncSettingsPayload(deviceId, payload);
        }
        finally {
            this.infoRequestInFlight = false;
        }
    }
    async pollCcu() {
        if (!this.started) {
            return;
        }
        if (this.ccuRequestInFlight) {
            this.adapter.log.debug('Cloud API CCU polling skipped because a request is still in flight.');
            return;
        }
        this.ccuRequestInFlight = true;
        try {
            const payload = await this.fetchWithRetry('ccu', async () => {
                const response = await this.requestClient.get(`${constants_1.CLOUD_API_BASE_URL}?ccu=${encodeURIComponent(this.config.ccuName)}`, {
                    timeoutMs: constants_1.CLOUD_CCU_REQUEST_TIMEOUT_MS,
                    label: `Cloud CCU request for ${this.config.ccuName}`,
                });
                return response.data;
            }, { retryCount: 0 });
            if (!(0, helpers_1.isRecord)(payload) || !this.started) {
                return;
            }
            const deviceId = typeof payload.deviceId === 'string' ? (0, helpers_1.normalizeDeviceId)(payload.deviceId) : '';
            if (!deviceId) {
                this.adapter.log.warn('Cloud API CCU response does not contain a valid deviceId.');
                return;
            }
            await this.stateManager.syncDevicePayload(deviceId, payload);
            const deviceTouchResult = await this.deviceRegistry.touch(deviceId);
            await this.onDeviceSeen(deviceTouchResult);
        }
        finally {
            this.ccuRequestInFlight = false;
        }
    }
    async fetchWithRetry(label, callback, options = {}) {
        const retryCount = options.retryCount ?? constants_1.CLOUD_RETRY_COUNT;
        const retryDelayMs = options.retryDelayMs ?? constants_1.CLOUD_RETRY_DELAY_MS;
        for (let attempt = 1; attempt <= retryCount + 1; attempt++) {
            if (!this.started) {
                return null;
            }
            try {
                const result = await callback();
                this.clearFailureLogState(label);
                return result;
            }
            catch (error) {
                if (!this.started) {
                    return null;
                }
                if (attempt <= retryCount) {
                    this.logThrottledFailure(`${label}:retry`, 'warn', `Cloud API ${label} request failed. Retrying ${attempt}/${retryCount}.`);
                    await (0, helpers_1.sleep)(retryDelayMs);
                    continue;
                }
                this.logThrottledFailure(`${label}:final`, 'error', `Cloud API ${label} request failed after retries: ${error instanceof Error ? error.message : String(error)}`);
                return null;
            }
        }
        return null;
    }
    clearFailureLogState(label) {
        this.failureLogStateByKey.delete(`${label}:retry`);
        this.failureLogStateByKey.delete(`${label}:final`);
    }
    logThrottledFailure(key, level, message) {
        const now = Date.now();
        const existing = this.failureLogStateByKey.get(key);
        if (existing && now - existing.lastLogTs < constants_1.CLOUD_FAILURE_LOG_THROTTLE_MS) {
            existing.suppressed += 1;
            return;
        }
        const suppressedCount = existing?.suppressed ?? 0;
        this.failureLogStateByKey.set(key, {
            lastLogTs: now,
            suppressed: 0,
        });
        const suppressedSuffix = suppressedCount > 0
            ? ` Suppressed ${suppressedCount} similar messages in the last ${Math.round(constants_1.CLOUD_FAILURE_LOG_THROTTLE_MS / 60_000)} minutes.`
            : '';
        this.adapter.log[level](`${message}${suppressedSuffix}`);
    }
}
exports.default = CloudApiPoller;
//# sourceMappingURL=cloudApiPoller.js.map