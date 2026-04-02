import {
  COMMAND_REQUEST_TIMEOUT_MS,
  COMMAND_RETRY_COUNT,
  COMMAND_RETRY_DELAY_MS,
} from "../constants";
import type { AdapterInstance, StateChange } from "../types/shared";
import {
  clampNumber,
  extractRelativeId,
  normalizeDeviceId,
  sleep,
} from "../utils/helpers";
import type RequestClient from "../network/requestClient";
import type StateManager from "../core/stateManager";

export type CommandId =
  | "maxOutputPower"
  | "offlinePower"
  | "baseLoad"
  | "offlineOutput"
  | "threshold"
  | "minSOC"
  | "maxSOC"
  | "autoCalibration";

interface CommandDefinition {
  id: CommandId;
  name: ioBroker.StringOrTranslated;
  type: ioBroker.CommonType;
  role: ioBroker.StateCommon["role"];
  min?: number;
  max?: number;
  unit?: string;
  states?: Record<number, string>;
}

const COMMAND_DEFINITIONS: readonly CommandDefinition[] = [
  {
    id: "maxOutputPower",
    name: {
      en: "Micro-inverter maximum power (W)",
      de: "Mikrowechselrichter maximale Leistung (W)",
    },
    type: "number",
    role: "level",
    min: 300,
    max: 2300,
    unit: "W",
  },
  {
    id: "offlinePower",
    name: {
      en: "Offline output power (W)",
      de: "Offline-Ausgangsleistung (W)",
    },
    type: "number",
    role: "level",
    min: 50,
    max: 600,
    unit: "W",
  },
  {
    id: "baseLoad",
    name: {
      en: "Adjust output (W)",
      de: "Ausgabe anpassen (W)",
    },
    type: "number",
    role: "level",
    min: -600,
    max: 600,
    unit: "W",
  },
  {
    id: "offlineOutput",
    name: {
      en: "Offline output (W)",
      de: "Offline-Ausgang (W)",
    },
    type: "number",
    role: "level",
    min: 50,
    max: 600,
    unit: "W",
  },
  {
    id: "threshold",
    name: {
      en: "Response tolerance (W)",
      de: "Reaktionstoleranz (W)",
    },
    type: "number",
    role: "level",
    min: 3,
    max: 50,
    unit: "W",
  },
  {
    id: "minSOC",
    name: {
      en: "Minimum battery discharge",
      de: "Minimale Batterieentladung",
    },
    type: "number",
    role: "level.min",
    min: 0,
    max: 99,
    unit: "%",
  },
  {
    id: "maxSOC",
    name: {
      en: "Maximum battery discharge",
      de: "Maximale Batterieentladung",
    },
    type: "number",
    role: "level.max",
    min: 20,
    max: 100,
    unit: "%",
  },
  {
    id: "autoCalibration",
    name: {
      en: "Auto calibration",
      de: "Automatische Kalibrierung",
    },
    type: "number",
    role: "level",
    min: 0,
    max: 1,
    states: {
      0: "Off",
      1: "On",
    },
  },
];

export default class CommandService {
  private readonly commandDefinitions = new Map<CommandId, CommandDefinition>(
    COMMAND_DEFINITIONS.map((definition) => [definition.id, definition]),
  );

  private readonly subscribedStateIds = new Set<string>();

  public constructor(
    private readonly adapter: AdapterInstance,
    private readonly stateManager: StateManager,
    private readonly requestClient: RequestClient,
  ) {}

  public async ensureDeviceStates(deviceId: string): Promise<void> {
    const normalizedDeviceId = normalizeDeviceId(deviceId);
    if (!normalizedDeviceId) {
      return;
    }

    await this.stateManager.ensureDevice(normalizedDeviceId);
    await this.stateManager.ensureChannel(`${normalizedDeviceId}.sendcommand`, {
      name: "sendcommand",
    });

    for (const definition of this.commandDefinitions.values()) {
      const relativeId = `${normalizedDeviceId}.sendcommand.${definition.id}`;
      const fullId = `${this.adapter.namespace}.${relativeId}`;

      await this.stateManager.ensureStateObject(relativeId, {
        name: definition.name,
        type: definition.type,
        role: definition.role,
        read: true,
        write: true,
        min: definition.min,
        max: definition.max,
        unit: definition.unit,
        states: definition.states,
      });

      if (!this.subscribedStateIds.has(fullId)) {
        this.adapter.subscribeStates(fullId);
        this.subscribedStateIds.add(fullId);
      }
    }
  }

  public async handleStateChange(
    id: string,
    state: StateChange,
  ): Promise<boolean> {
    if (!state || state.ack) {
      return false;
    }

    const parsedState = this.parseCommandStateId(id);
    if (!parsedState) {
      return false;
    }

    await this.applyDeviceSetting(
      parsedState.deviceId,
      parsedState.commandId,
      state.val,
      {
        source: "stateChange",
      },
    );
    return true;
  }

  public async applyDeviceSetting(
    deviceId: string,
    commandId: CommandId,
    rawValue: unknown,
    options: { source?: string } = {},
  ): Promise<boolean> {
    const normalizedDeviceId = normalizeDeviceId(deviceId);
    const definition = this.commandDefinitions.get(commandId);

    if (!normalizedDeviceId || !definition) {
      this.adapter.log.warn(
        `CommandService: Unsupported command ${commandId} for device ${deviceId}.`,
      );
      return false;
    }

    const normalizedValue = this.normalizeValue(definition, rawValue);
    if (normalizedValue === null) {
      this.adapter.log.warn(
        `CommandService: Invalid value ${JSON.stringify(rawValue)} for ${commandId}.`,
      );
      return false;
    }

    await this.ensureDeviceStates(normalizedDeviceId);

    const ipAddress = await this.resolveDeviceIp(normalizedDeviceId);
    if (!ipAddress) {
      this.adapter.log.error(
        `CommandService: No IP address found for device ${normalizedDeviceId}.`,
      );
      return false;
    }

    const sendSucceeded = await this.sendCommandWithRetry(
      ipAddress,
      commandId,
      normalizedValue,
      normalizedDeviceId,
      options.source,
    );

    if (!sendSucceeded) {
      return false;
    }

    await this.stateManager.setStateIfChanged(
      `${normalizedDeviceId}.sendcommand.${commandId}`,
      normalizedValue,
      true,
    );

    return true;
  }

  public dispose(): Promise<void> {
    for (const fullId of this.subscribedStateIds) {
      this.adapter.unsubscribeStates(fullId);
    }

    this.subscribedStateIds.clear();
    return Promise.resolve();
  }

  private async sendCommandWithRetry(
    ipAddress: string,
    commandId: CommandId,
    value: number,
    deviceId: string,
    source?: string,
  ): Promise<boolean> {
    const url = `http://${ipAddress}/config`;
    const payload = new URLSearchParams({
      [commandId]: String(value),
    }).toString();

    for (let attempt = 1; attempt <= COMMAND_RETRY_COUNT + 1; attempt++) {
      try {
        await this.requestClient.post(url, payload, {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          timeoutMs: COMMAND_REQUEST_TIMEOUT_MS,
          label: `Command ${commandId} for ${deviceId}`,
        });

        this.adapter.log.debug(
          `CommandService: Sent ${commandId}=${value} to ${deviceId}${
            source ? ` (${source})` : ""
          }.`,
        );
        return true;
      } catch (error) {
        if (attempt <= COMMAND_RETRY_COUNT) {
          this.adapter.log.warn(
            `CommandService: Retry ${attempt}/${COMMAND_RETRY_COUNT} for ${commandId} on ${deviceId}.`,
          );
          await sleep(COMMAND_RETRY_DELAY_MS);
          continue;
        }

        this.adapter.log.error(
          `CommandService: Failed to send ${commandId}=${value} to ${deviceId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return false;
      }
    }

    return false;
  }

  private normalizeValue(
    definition: CommandDefinition,
    rawValue: unknown,
  ): number | null {
    if (definition.type !== "number") {
      return null;
    }

    const numericValue = Number(rawValue);
    if (!Number.isFinite(numericValue)) {
      return null;
    }

    const roundedValue = Math.round(numericValue);
    const clampedValue = clampNumber(
      roundedValue,
      definition.min,
      definition.max,
    );

    if (clampedValue !== roundedValue) {
      this.adapter.log.warn(
        `CommandService: Clamped ${definition.id} from ${roundedValue} to ${clampedValue}.`,
      );
    }

    return clampedValue;
  }

  private parseCommandStateId(
    fullId: string,
  ): { deviceId: string; commandId: CommandId } | null {
    const relativeId = extractRelativeId(this.adapter.namespace, fullId);
    if (!relativeId) {
      return null;
    }

    const parts = relativeId.split(".");
    if (parts.length !== 3 || parts[1] !== "sendcommand") {
      return null;
    }

    const rawCommandId = parts[2];
    if (!this.commandDefinitions.has(rawCommandId as CommandId)) {
      this.adapter.log.warn(
        `CommandService: Unknown command datapoint ${fullId}.`,
      );
      return null;
    }

    return {
      deviceId: normalizeDeviceId(parts[0]),
      commandId: rawCommandId as CommandId,
    };
  }

  private async resolveDeviceIp(deviceId: string): Promise<string | null> {
    const ipState = await this.adapter.getStateAsync(`${deviceId}.ip_addr`);
    const ipAddress =
      typeof ipState?.val === "string" ? ipState.val.trim() : "";
    return ipAddress || null;
  }
}
