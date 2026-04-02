import type { AdapterInstance } from "../types/shared";
export default class StateManager {
  private readonly adapter;
  private readonly objectDefinitionCache;
  private readonly stateValueCache;
  constructor(adapter: AdapterInstance);
  ensureInfoStructure(): Promise<void>;
  ensureDevice(deviceId: string): Promise<void>;
  ensureChannel(id: string, common: Record<string, unknown>): Promise<void>;
  ensureFolder(id: string, common: Record<string, unknown>): Promise<void>;
  ensureStateObject(id: string, common: Record<string, unknown>): Promise<void>;
  setStateIfChanged(
    id: string,
    value: ioBroker.StateValue,
    ack?: boolean,
  ): Promise<boolean>;
  setInfoStates(deviceIds: string[]): Promise<void>;
  resetInfoStates(): Promise<void>;
  syncDevicePayload(deviceId: string, payload: unknown): Promise<void>;
  syncSettingsPayload(deviceId: string, payload: unknown): Promise<void>;
  clearCaches(): void;
  private ensureObject;
  private syncPayloadRecursive;
  private normalizeStateValue;
}
//# sourceMappingURL=stateManager.d.ts.map
