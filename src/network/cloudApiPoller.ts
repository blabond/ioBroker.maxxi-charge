import {
    CLOUD_API_BASE_URL,
    CLOUD_CCU_INITIAL_DELAY_MS,
    CLOUD_CCU_REQUEST_TIMEOUT_MS,
    CLOUD_FAILURE_LOG_THROTTLE_MS,
    CLOUD_INFO_INTERVAL_MS,
    CLOUD_RETRY_COUNT,
    CLOUD_RETRY_DELAY_MS,
    REQUEST_TIMEOUT_MS,
} from '../constants';
import type { AdapterInstance, DeviceTouchEvent } from '../types/shared';
import { isRecord, normalizeDeviceId, sleep } from '../utils/helpers';
import type DeviceRegistry from '../core/deviceRegistry';
import type Scheduler from '../core/scheduler';
import type StateManager from '../core/stateManager';
import type RequestClient from './requestClient';

export default class CloudApiPoller {
    private infoIntervalHandle: ioBroker.Interval = null;

    private ccuIntervalHandle: ioBroker.Interval = null;

    private infoStartHandle: ioBroker.Timeout = null;

    private ccuStartHandle: ioBroker.Timeout = null;

    private infoRequestInFlight = false;

    private ccuRequestInFlight = false;

    private started = false;

    private readonly failureLogStateByKey = new Map<string, { lastLogTs: number; suppressed: number }>();

    public constructor(
        private readonly adapter: AdapterInstance,
        private readonly config: { ccuName: string; ccuIntervalMs: number },
        private readonly scheduler: Scheduler,
        private readonly stateManager: StateManager,
        private readonly deviceRegistry: DeviceRegistry,
        private readonly requestClient: RequestClient,
        private readonly onDeviceSeen: (deviceEvent: DeviceTouchEvent) => Promise<void>,
    ) {}

    public start(): Promise<void> {
        if (this.started) {
            return Promise.resolve();
        }

        if (!this.config.ccuName) {
            this.adapter.log.warn('Cloud API mode is enabled but no CCU name is configured.');
            return Promise.resolve();
        }

        this.started = true;

        const infoStartDelay = Math.floor(Math.random() * CLOUD_INFO_INTERVAL_MS);

        this.infoStartHandle = this.scheduler.setTimeout(
            async () => {
                await this.pollInfo();
                this.infoIntervalHandle = this.scheduler.setInterval(
                    async () => {
                        await this.pollInfo();
                    },
                    CLOUD_INFO_INTERVAL_MS,
                    'cloud-info-poll',
                );
            },
            infoStartDelay,
            'cloud-info-start',
        );

        this.ccuStartHandle = this.scheduler.setTimeout(
            async () => {
                await this.pollCcu();
                this.ccuIntervalHandle = this.scheduler.setInterval(
                    async () => {
                        await this.pollCcu();
                    },
                    this.config.ccuIntervalMs,
                    'cloud-ccu-poll',
                );
            },
            CLOUD_CCU_INITIAL_DELAY_MS,
            'cloud-ccu-start',
        );

        return Promise.resolve();
    }

    public dispose(): Promise<void> {
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

    private async pollInfo(): Promise<void> {
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
                const response = await this.requestClient.get(
                    `${CLOUD_API_BASE_URL}?info=${encodeURIComponent(this.config.ccuName)}`,
                    {
                        timeoutMs: REQUEST_TIMEOUT_MS,
                        label: `Cloud info request for ${this.config.ccuName}`,
                    },
                );
                return response.data;
            });

            if (!isRecord(payload) || !this.started) {
                return;
            }

            const deviceId = typeof payload.deviceId === 'string' ? normalizeDeviceId(payload.deviceId) : '';
            if (!deviceId) {
                this.adapter.log.warn('Cloud API info response does not contain a valid deviceId.');
                return;
            }

            await this.stateManager.syncSettingsPayload(deviceId, payload);
        } finally {
            this.infoRequestInFlight = false;
        }
    }

    private async pollCcu(): Promise<void> {
        if (!this.started) {
            return;
        }

        if (this.ccuRequestInFlight) {
            this.adapter.log.debug('Cloud API CCU polling skipped because a request is still in flight.');
            return;
        }

        this.ccuRequestInFlight = true;

        try {
            const payload = await this.fetchWithRetry(
                'ccu',
                async () => {
                    const response = await this.requestClient.get(
                        `${CLOUD_API_BASE_URL}?ccu=${encodeURIComponent(this.config.ccuName)}`,
                        {
                            timeoutMs: CLOUD_CCU_REQUEST_TIMEOUT_MS,
                            label: `Cloud CCU request for ${this.config.ccuName}`,
                        },
                    );
                    return response.data;
                },
                { retryCount: 0 },
            );

            if (!isRecord(payload) || !this.started) {
                return;
            }

            const deviceId = typeof payload.deviceId === 'string' ? normalizeDeviceId(payload.deviceId) : '';
            if (!deviceId) {
                this.adapter.log.warn('Cloud API CCU response does not contain a valid deviceId.');
                return;
            }

            await this.stateManager.syncDevicePayload(deviceId, payload);

            const deviceTouchResult = await this.deviceRegistry.touch(deviceId);
            await this.onDeviceSeen(deviceTouchResult);
        } finally {
            this.ccuRequestInFlight = false;
        }
    }

    private async fetchWithRetry<T>(
        label: string,
        callback: () => Promise<T>,
        options: { retryCount?: number; retryDelayMs?: number } = {},
    ): Promise<T | null> {
        const retryCount = options.retryCount ?? CLOUD_RETRY_COUNT;
        const retryDelayMs = options.retryDelayMs ?? CLOUD_RETRY_DELAY_MS;

        for (let attempt = 1; attempt <= retryCount + 1; attempt++) {
            if (!this.started) {
                return null;
            }

            try {
                const result = await callback();
                this.clearFailureLogState(label);
                return result;
            } catch (error) {
                if (!this.started) {
                    return null;
                }

                if (attempt <= retryCount) {
                    this.logThrottledFailure(
                        `${label}:retry`,
                        'warn',
                        `Cloud API ${label} request failed. Retrying ${attempt}/${retryCount}.`,
                    );
                    await sleep(this.adapter, retryDelayMs);
                    continue;
                }

                this.logThrottledFailure(
                    `${label}:final`,
                    'error',
                    `Cloud API ${label} request failed after retries: ${
                        error instanceof Error ? error.message : String(error)
                    }`,
                );
                return null;
            }
        }

        return null;
    }

    private clearFailureLogState(label: string): void {
        this.failureLogStateByKey.delete(`${label}:retry`);
        this.failureLogStateByKey.delete(`${label}:final`);
    }

    private logThrottledFailure(key: string, level: 'warn' | 'error', message: string): void {
        const now = Date.now();
        const existing = this.failureLogStateByKey.get(key);

        if (existing && now - existing.lastLogTs < CLOUD_FAILURE_LOG_THROTTLE_MS) {
            existing.suppressed += 1;
            return;
        }

        const suppressedCount = existing?.suppressed ?? 0;
        this.failureLogStateByKey.set(key, {
            lastLogTs: now,
            suppressed: 0,
        });

        const suppressedSuffix =
            suppressedCount > 0
                ? ` Suppressed ${suppressedCount} similar messages in the last ${Math.round(CLOUD_FAILURE_LOG_THROTTLE_MS / 60_000)} minutes.`
                : '';

        this.adapter.log[level](`${message}${suppressedSuffix}`);
    }
}
