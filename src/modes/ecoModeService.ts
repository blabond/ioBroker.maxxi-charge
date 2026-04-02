import type {
  AdapterInstance,
  RuntimeConfig,
  StateChange,
} from "../types/shared";
import { getDateValue, isInWrappedRange } from "../utils/date";
import { extractRelativeId } from "../utils/helpers";
import type CommandService from "../commands/commandService";
import type DeviceRegistry from "../core/deviceRegistry";
import type Scheduler from "../core/scheduler";

export default class EcoModeService {
  private dailyJob: { cancel(reschedule?: boolean): boolean } | null = null;

  private minSocSetToday = false;

  private started = false;

  public constructor(
    private readonly adapter: AdapterInstance,
    private readonly config: RuntimeConfig,
    private readonly scheduler: Scheduler,
    private readonly commandService: CommandService,
    private readonly deviceRegistry: DeviceRegistry,
  ) {}

  public async start(): Promise<void> {
    if (
      !this.config.seasonModeEnabled ||
      this.config.batteryCalibrationEnabled
    ) {
      return;
    }

    if (!this.config.winterFrom || !this.config.winterTo) {
      this.adapter.log.warn(
        "EcoMode: Winter dates are invalid. Season mode will stay inactive.",
      );
      return;
    }

    if (this.started) {
      return;
    }

    this.dailyJob = this.scheduler.scheduleCron(
      `${this.adapter.namespace}-eco-evaluation`,
      "0 8 * * *",
      async () => {
        await this.evaluateSeason();
      },
    );

    this.started = true;

    const activeDeviceId = this.deviceRegistry.getPrimaryDeviceId();
    if (activeDeviceId) {
      await this.evaluateSeason(activeDeviceId);
    }
  }

  public async handleDeviceAvailable(deviceId: string): Promise<void> {
    if (!this.started) {
      return;
    }

    await this.evaluateSeason(deviceId);
  }

  public handleConnectionLost(): void {
    this.minSocSetToday = false;
  }

  public async handleSocChange(id: string, state: StateChange): Promise<void> {
    if (
      !this.started ||
      !state?.ack ||
      typeof state.val !== "number" ||
      this.minSocSetToday
    ) {
      return;
    }

    const deviceId = this.extractDeviceId(id);
    if (!deviceId) {
      return;
    }

    const todayValue = this.getTodayValue();
    const winterFromValue = getDateValue(this.config.winterFrom);
    const winterToValue = getDateValue(this.config.winterTo);

    const inWinterRange = isInWrappedRange(
      todayValue,
      winterFromValue,
      winterToValue,
    );
    const isWinterEndDate = todayValue === winterToValue;

    if (!inWinterRange && !isWinterEndDate) {
      return;
    }

    if (state.val >= 55) {
      const updated = await this.commandService.applyDeviceSetting(
        deviceId,
        "minSOC",
        40,
        { source: "ecoMode:socTrigger" },
      );

      if (updated) {
        this.minSocSetToday = true;
      }
    }
  }

  public dispose(): Promise<void> {
    this.minSocSetToday = false;

    if (this.dailyJob) {
      this.scheduler.cancelJob(this.dailyJob);
      this.dailyJob = null;
    }

    this.started = false;
    return Promise.resolve();
  }

  private async evaluateSeason(preferredDeviceId?: string): Promise<void> {
    const deviceId =
      preferredDeviceId ?? this.deviceRegistry.getPrimaryDeviceId();
    if (!deviceId) {
      this.adapter.log.debug(
        "EcoMode: No active device available for evaluation.",
      );
      return;
    }

    const todayValue = this.getTodayValue();
    const winterFromValue = getDateValue(this.config.winterFrom);
    const winterToValue = getDateValue(this.config.winterTo);

    if (todayValue === winterToValue) {
      const updated = await this.applySummerSettings(deviceId);
      if (updated) {
        this.minSocSetToday = true;
      }
      return;
    }

    if (isInWrappedRange(todayValue, winterFromValue, winterToValue)) {
      const minSocUpdated = await this.commandService.applyDeviceSetting(
        deviceId,
        "minSOC",
        60,
        { source: "ecoMode:winter" },
      );
      const maxSocUpdated = await this.commandService.applyDeviceSetting(
        deviceId,
        "maxSOC",
        this.config.feedInMode,
        { source: "ecoMode:winter" },
      );
      if (minSocUpdated && maxSocUpdated) {
        this.minSocSetToday = false;
      }
      return;
    }

    const updated = await this.applySummerSettings(deviceId);
    if (updated) {
      this.minSocSetToday = true;
    }
  }

  private async applySummerSettings(deviceId: string): Promise<boolean> {
    const minSocUpdated = await this.commandService.applyDeviceSetting(
      deviceId,
      "minSOC",
      10,
      { source: "ecoMode:summer" },
    );
    const maxSocUpdated = await this.commandService.applyDeviceSetting(
      deviceId,
      "maxSOC",
      this.config.feedInMode,
      { source: "ecoMode:summer" },
    );

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
      return "";
    }

    return relativeId.split(".")[0] ?? "";
  }
}
