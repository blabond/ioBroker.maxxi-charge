import type { AdapterInstance, StateChange } from "../types/shared";
import type RequestClient from "../network/requestClient";
import type StateManager from "../core/stateManager";
export type CommandId = "maxOutputPower" | "offlinePower" | "baseLoad" | "offlineMode" | "threshold" | "minSOC" | "maxSOC";
export default class CommandService {
    private readonly adapter;
    private readonly stateManager;
    private readonly requestClient;
    private readonly commandDefinitions;
    private readonly confirmedCommandValueCache;
    private readonly subscribedStateIds;
    constructor(adapter: AdapterInstance, stateManager: StateManager, requestClient: RequestClient);
    ensureDeviceStates(deviceId: string): Promise<void>;
    syncDeviceCommandConfiguration(deviceId: string): Promise<void>;
    handleStateChange(id: string, state: StateChange): Promise<boolean>;
    applyDeviceSetting(deviceId: string, commandId: CommandId, rawValue: unknown, _options?: {
        source?: string;
    }): Promise<boolean>;
    dispose(): Promise<void>;
    handleDeviceInactive(deviceId: string): void;
    private ensureSendcommandInitializedState;
    private getSendcommandInitializedStateId;
    private resetSendcommandFolder;
    private sendCommandWithRetry;
    private normalizeValue;
    private parseCommandStateId;
    private resolveDeviceIp;
    private getCommandStateId;
    private getConfirmedCommandValueCacheKey;
    private hasConfirmedCommandValue;
}
//# sourceMappingURL=commandService.d.ts.map