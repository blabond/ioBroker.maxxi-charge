import type {
  AdapterInstance,
  JsonValue,
  ObjectDefinition,
} from "../types/shared";
import {
  areValuesEqual,
  buildComparableObjectDefinition,
  isRecord,
  nameToId,
  serializeComparable,
} from "../utils/helpers";
import { determineRole } from "../utils/roles";

const DYNAMIC_FOLDER_KEYS = new Set(["batteriesInfo", "convertersInfo"]);

function getStateType(value: ioBroker.StateValue): ioBroker.CommonType {
  if (value === null) {
    return "mixed";
  }

  if (Array.isArray(value)) {
    return "array";
  }

  if (typeof value === "boolean") {
    return "boolean";
  }

  if (typeof value === "number") {
    return "number";
  }

  if (typeof value === "string") {
    return "string";
  }

  return "mixed";
}

function isContainerValue(
  value: unknown,
): value is Record<string, unknown> | unknown[] {
  return Array.isArray(value) || isRecord(value);
}

function createComparableExistingObject(
  existingObject: ioBroker.Object,
  desiredDefinition: ObjectDefinition,
): string {
  const comparableCommon: Record<string, unknown> = {};
  const comparableNative: Record<string, unknown> = {};

  for (const key of Object.keys(desiredDefinition.common)) {
    comparableCommon[key] = (existingObject.common as Record<string, unknown>)[
      key
    ];
  }

  for (const key of Object.keys(desiredDefinition.native)) {
    comparableNative[key] = (existingObject.native as Record<string, unknown>)[
      key
    ];
  }

  return buildComparableObjectDefinition({
    type: existingObject.type,
    common: comparableCommon,
    native: comparableNative,
  });
}

export default class StateManager {
  private readonly objectDefinitionCache = new Map<string, string>();

  private readonly stateValueCache = new Map<string, string>();

  public constructor(private readonly adapter: AdapterInstance) {}

  public async ensureInfoStructure(): Promise<void> {
    await this.ensureChannel("info", {
      name: {
        en: "Information",
        de: "Information",
      },
    });

    await this.ensureStateObject("info.connection", {
      name: {
        en: "Connection active",
        de: "Verbindung aktiv",
      },
      type: "boolean",
      role: "indicator.connected",
      read: true,
      write: false,
    });

    await this.ensureStateObject("info.aktivCCU", {
      name: {
        en: "Active CCUs",
        de: "Aktive CCUs",
      },
      type: "string",
      role: "text",
      read: true,
      write: false,
    });

  }

  public async ensureDevice(deviceId: string): Promise<void> {
    await this.ensureObject(deviceId, {
      type: "device",
      common: { name: deviceId },
      native: {},
    });
  }

  public async ensureChannel(
    id: string,
    common: Record<string, unknown>,
  ): Promise<void> {
    await this.ensureObject(id, {
      type: "channel",
      common,
      native: {},
    });
  }

  public async ensureFolder(
    id: string,
    common: Record<string, unknown>,
  ): Promise<void> {
    await this.ensureObject(id, {
      type: "folder",
      common,
      native: {},
    });
  }

  public async ensureStateObject(
    id: string,
    common: Record<string, unknown>,
  ): Promise<void> {
    await this.ensureObject(id, {
      type: "state",
      common,
      native: {},
    });
  }

  public async setStateIfChanged(
    id: string,
    value: ioBroker.StateValue,
    ack = true,
  ): Promise<boolean> {
    const cacheKey = `${ack}:${serializeComparable(value)}`;
    if (this.stateValueCache.get(id) === cacheKey) {
      return false;
    }

    const existingState = await this.adapter.getStateAsync(id);
    if (
      existingState &&
      existingState.ack === ack &&
      areValuesEqual(existingState.val, value)
    ) {
      this.stateValueCache.set(id, cacheKey);
      return false;
    }

    await this.adapter.setStateAsync(id, { val: value, ack });
    this.stateValueCache.set(id, cacheKey);
    return true;
  }

  public async setInfoStates(deviceIds: string[]): Promise<void> {
    const uniqueDeviceIds = [...new Set(deviceIds)];

    await this.setStateIfChanged(
      "info.aktivCCU",
      uniqueDeviceIds.join(","),
      true,
    );
    await this.setStateIfChanged(
      "info.connection",
      uniqueDeviceIds.length > 0,
      true,
    );
  }

  public async resetInfoStates(): Promise<void> {
    await this.setInfoStates([]);
  }

  public async syncDevicePayload(
    deviceId: string,
    payload: unknown,
  ): Promise<void> {
    await this.ensureDevice(deviceId);
    await this.syncPayloadRecursive(deviceId, payload);
  }

  public async syncSettingsPayload(
    deviceId: string,
    payload: unknown,
  ): Promise<void> {
    await this.ensureDevice(deviceId);
    await this.ensureChannel(`${deviceId}.settings`, { name: "settings" });
    await this.syncPayloadRecursive(`${deviceId}.settings`, payload);
  }

  public clearCaches(): void {
    this.objectDefinitionCache.clear();
    this.stateValueCache.clear();
  }

  private async ensureObject(
    id: string,
    definition: ObjectDefinition,
  ): Promise<void> {
    const fingerprint = buildComparableObjectDefinition(definition);
    if (this.objectDefinitionCache.get(id) === fingerprint) {
      return;
    }

    const existingObject = await this.adapter.getObjectAsync(id);
    if (!existingObject) {
      await this.adapter.setObjectNotExistsAsync(
        id,
        definition as ioBroker.SettableObject,
      );
      this.objectDefinitionCache.set(id, fingerprint);
      return;
    }

    const existingFingerprint = createComparableExistingObject(
      existingObject,
      definition,
    );

    if (existingFingerprint !== fingerprint) {
      if (existingObject.type !== definition.type) {
        this.adapter.log.warn(
          `StateManager: Object ${id} exists with unexpected type ${existingObject.type}; expected ${definition.type}.`,
        );
      }

      await this.adapter.extendObjectAsync(id, {
        common: definition.common as unknown as ioBroker.ObjectCommon,
        native: definition.native,
      });
    }

    this.objectDefinitionCache.set(id, fingerprint);
  }

  private async syncPayloadRecursive(
    parentId: string,
    payload: unknown,
  ): Promise<void> {
    if (!isContainerValue(payload)) {
      return;
    }

    const entries = Array.isArray(payload)
      ? payload.map((value, index) => [String(index), value] as const)
      : Object.entries(payload);

    for (const [rawKey, value] of entries) {
      const key = String(rawKey);
      const safeKey = nameToId(key);
      const id = `${parentId}.${safeKey}`;

      if (isContainerValue(value)) {
        const isFolder = Array.isArray(value) || DYNAMIC_FOLDER_KEYS.has(key);
        if (isFolder) {
          await this.ensureFolder(id, { name: key });
        } else {
          await this.ensureChannel(id, { name: key });
        }

        await this.syncPayloadRecursive(id, value);
        continue;
      }

      const stateValue = this.normalizeStateValue(value as JsonValue);
      if (typeof stateValue === "undefined") {
        continue;
      }

      await this.ensureStateObject(id, {
        name: key,
        type: getStateType(stateValue),
        role: determineRole(key),
        read: true,
        write: false,
      });

      await this.setStateIfChanged(id, stateValue, true);
    }
  }

  private normalizeStateValue(
    value: JsonValue | undefined,
  ): ioBroker.StateValue | undefined {
    if (
      value === null ||
      typeof value === "boolean" ||
      typeof value === "number" ||
      typeof value === "string"
    ) {
      return value;
    }

    return undefined;
  }
}
