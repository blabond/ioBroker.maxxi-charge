import type { AdapterInstance, ManagedStateCommon } from "../types/shared";
export default class StateManager {
    private readonly adapter;
    private readonly objectDefinitionCache;
    private readonly stateValueCache;
    constructor(adapter: AdapterInstance);
    ensureInfoStructure(): Promise<void>;
    ensureDevice(deviceId: string): Promise<void>;
    ensureChannel(id: string, common: ioBroker.ChannelCommon): Promise<void>;
    ensureFolder(id: string, common: ioBroker.OtherCommon): Promise<void>;
    ensureStateObject(id: string, common: ManagedStateCommon): Promise<void>;
    setStateIfChanged(id: string, value: ioBroker.StateValue, ack?: boolean): Promise<boolean>;
    setInfoStates(deviceIds: string[]): Promise<void>;
    resetInfoStates(): Promise<void>;
    syncDevicePayload(deviceId: string, payload: unknown): Promise<void>;
    syncSettingsPayload(deviceId: string, payload: unknown): Promise<void>;
    clearCaches(): void;
    private ensureObject;
    private syncPayloadRecursive;
    private normalizeStateValue;
    private toSettableObject;
    private toPartialObject;
}
//# sourceMappingURL=stateManager.d.ts.map