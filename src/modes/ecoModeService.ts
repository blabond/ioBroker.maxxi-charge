import type { AdapterInstance, RuntimeConfig, StateChange } from '../types/shared';
import {
    ECO_SOC_TRIGGER_THRESHOLD,
    ECO_SUMMER_MIN_SOC,
    ECO_WINTER_MIN_SOC,
    ECO_WINTER_RELAXED_MIN_SOC,
} from '../constants';
import { getDateValue, isInWrappedRange } from '../utils/date';
import { extractRelativeId } from '../utils/helpers';
import type CommandService from '../commands/commandService';
import type DeviceRegistry from '../core/deviceRegistry';
import type Scheduler from '../core/scheduler';

export default class EcoModeService {
    private dailyJob: { cancel(reschedule?: boolean): boolean } | null = null;

    private readonly minSocSetTodayByDevice = new Map<string, boolean>();

    private started = false;

    public constructor(
        private readonly adapter: AdapterInstance,
        private readonly config: RuntimeConfig,
        private readonly scheduler: Scheduler,
        private readonly commandService: CommandService,
        private readonly deviceRegistry: DeviceRegistry,
    ) {}

    public async start(): Promise<void> {
        if (!this.config.seasonModeEnabled || this.config.batteryCalibrationEnabled) {
            return;
        }

        if (!this.config.winterFrom || !this.config.winterTo) {
            this.adapter.log.warn('EcoMode: Winter dates are invalid. Season mode will stay inactive.');
            return;
        }

        if (this.started) {
            return;
        }

        this.dailyJob = this.scheduler.scheduleCron(
            `${this.adapter.namespace}-eco-evaluation`,
            '0 8 * * *',
            async () => {
                await this.evaluateActiveDevices();
            },
        );

        this.started = true;
        await this.evaluateActiveDevices();
    }

    public async handleDeviceAvailable(deviceId: string): Promise<void> {
        if (!this.started) {
            return;
        }

        const normalizedDeviceId = deviceId.trim();
        if (!normalizedDeviceId) {
            return;
        }

        await this.evaluateSeason(normalizedDeviceId);
    }

    public handleDeviceInactive(deviceId: string): void {
        const normalizedDeviceId = deviceId.trim();
        if (!normalizedDeviceId) {
            return;
        }

        this.minSocSetTodayByDevice.delete(normalizedDeviceId);
    }

    public handleConnectionLost(): void {
        this.minSocSetTodayByDevice.clear();
    }

    public async handleSocChange(id: string, state: StateChange): Promise<void> {
        if (!this.started || !state?.ack || typeof state.val !== 'number') {
            return;
        }

        const deviceId = this.extractDeviceId(id);
        if (!deviceId || this.minSocSetTodayByDevice.get(deviceId)) {
            return;
        }

        const todayValue = this.getTodayValue();
        const winterFromValue = getDateValue(this.config.winterFrom);
        const winterToValue = getDateValue(this.config.winterTo);

        const inWinterRange = isInWrappedRange(todayValue, winterFromValue, winterToValue);
        const isWinterEndDate = todayValue === winterToValue;

        if (!inWinterRange && !isWinterEndDate) {
            return;
        }

        if (state.val >= ECO_SOC_TRIGGER_THRESHOLD) {
            const updated = await this.commandService.applyDeviceSetting(
                deviceId,
                'minSOC',
                ECO_WINTER_RELAXED_MIN_SOC,
                { source: 'ecoMode:socTrigger' },
            );

            if (updated) {
                this.minSocSetTodayByDevice.set(deviceId, true);
            }
        }
    }

    public dispose(): Promise<void> {
        this.minSocSetTodayByDevice.clear();

        if (this.dailyJob) {
            this.scheduler.cancelJob(this.dailyJob);
            this.dailyJob = null;
        }

        this.started = false;
        return Promise.resolve();
    }

    private async evaluateActiveDevices(): Promise<void> {
        const activeDeviceIds = this.deviceRegistry.getActiveDeviceIds();
        if (activeDeviceIds.length === 0) {
            this.adapter.log.debug('EcoMode: No active device available for evaluation.');
            return;
        }

        for (const deviceId of activeDeviceIds) {
            await this.evaluateSeason(deviceId);
        }
    }

    private async evaluateSeason(deviceId: string): Promise<void> {
        if (!deviceId) {
            return;
        }

        const todayValue = this.getTodayValue();
        const winterFromValue = getDateValue(this.config.winterFrom);
        const winterToValue = getDateValue(this.config.winterTo);

        if (todayValue === winterToValue) {
            const updated = await this.applySummerSettings(deviceId);
            if (updated) {
                this.minSocSetTodayByDevice.set(deviceId, true);
            }
            return;
        }

        if (isInWrappedRange(todayValue, winterFromValue, winterToValue)) {
            const minSocUpdated = await this.commandService.applyDeviceSetting(deviceId, 'minSOC', ECO_WINTER_MIN_SOC, {
                source: 'ecoMode:winter',
            });
            const maxSocUpdated = await this.commandService.applyDeviceSetting(
                deviceId,
                'maxSOC',
                this.config.feedInMode,
                { source: 'ecoMode:winter' },
            );
            if (minSocUpdated && maxSocUpdated) {
                this.minSocSetTodayByDevice.set(deviceId, false);
            }
            return;
        }

        const updated = await this.applySummerSettings(deviceId);
        if (updated) {
            this.minSocSetTodayByDevice.set(deviceId, true);
        }
    }

    private async applySummerSettings(deviceId: string): Promise<boolean> {
        const minSocUpdated = await this.commandService.applyDeviceSetting(deviceId, 'minSOC', ECO_SUMMER_MIN_SOC, {
            source: 'ecoMode:summer',
        });
        const maxSocUpdated = await this.commandService.applyDeviceSetting(deviceId, 'maxSOC', this.config.feedInMode, {
            source: 'ecoMode:summer',
        });

        return minSocUpdated && maxSocUpdated;
    }

    private getTodayValue(): number | null {
        const now = new Date();
        return getDateValue({
            day: now.getDate(),
            month: now.getMonth() + 1,
        });
    }

    private extractDeviceId(fullId: string): string {
        const relativeId = extractRelativeId(this.adapter.namespace, fullId);
        if (!relativeId) {
            return '';
        }

        return relativeId.split('.')[0] ?? '';
    }
}
