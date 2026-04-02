import { BKW_SOC_THRESHOLD } from "../constants";
import type {
  AdapterInstance,
  RuntimeConfig,
  StateChange,
} from "../types/shared";
import { extractRelativeId } from "../utils/helpers";
import type CommandService from "../commands/commandService";
import type DeviceRegistry from "../core/deviceRegistry";

export default class BkwModeService {
  private lastState: "high" | "low" | null = null;

  public constructor(
    private readonly adapter: AdapterInstance,
    private readonly config: RuntimeConfig,
    private readonly commandService: CommandService,
    private readonly deviceRegistry: DeviceRegistry,
  ) {}

  public handleConnectionLost(): void {
    this.lastState = null;
  }

  public async handleSocChange(id: string, state: StateChange): Promise<void> {
    if (
      !state?.ack ||
      typeof state.val !== "number" ||
      !this.config.bkwEnabled ||
      this.config.batteryCalibrationEnabled
    ) {
      return;
    }

    const deviceId =
      this.extractDeviceId(id) ?? this.deviceRegistry.getPrimaryDeviceId();
    if (!deviceId) {
      return;
    }

    let nextState: "high" | "low" | null = null;
    let targetValue: number | null = null;

    if (state.val >= BKW_SOC_THRESHOLD && this.lastState !== "high") {
      targetValue = -this.config.bkwPowerTarget;
      nextState = "high";
    } else if (state.val < BKW_SOC_THRESHOLD && this.lastState !== "low") {
      targetValue = this.config.bkwAdjustment;
      nextState = "low";
    }

    if (targetValue === null) {
      return;
    }

    const updated = await this.commandService.applyDeviceSetting(
      deviceId,
      "baseLoad",
      targetValue,
      { source: "bkwMode" },
    );

    if (updated) {
      this.lastState = nextState;
      this.adapter.log.debug(
        `BkwMode: baseLoad set to ${targetValue} W for ${deviceId} (SOC=${state.val}%).`,
      );
    }
  }

  public dispose(): Promise<void> {
    this.lastState = null;
    return Promise.resolve();
  }

  private extractDeviceId(fullId: string): string | null {
    const relativeId = extractRelativeId(this.adapter.namespace, fullId);
    if (!relativeId) {
      return null;
    }

    return relativeId.split(".")[0] ?? null;
  }
}
