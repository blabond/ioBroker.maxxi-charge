import type { AdapterInstance, RuntimeConfig, StateChange } from "../types/shared";
import type CommandService from "../commands/commandService";
import type DeviceRegistry from "../core/deviceRegistry";
import type StateManager from "../core/stateManager";
export default class BkwModeService {
    private readonly adapter;
    private readonly config;
    private readonly commandService;
    private readonly deviceRegistry;
    private readonly stateManager;
    private readonly lastStateByDevice;
    private readonly initializedDeviceIds;
    private readonly maxSocForcedDeviceIds;
    constructor(adapter: AdapterInstance, config: RuntimeConfig, commandService: CommandService, deviceRegistry: DeviceRegistry, stateManager: StateManager);
    start(): Promise<void>;
    handleDeviceAvailable(deviceId: string): Promise<void>;
    handleDeviceInactive(deviceId: string): void;
    handleConnectionLost(): void;
    handleSocChange(id: string, state: StateChange): Promise<void>;
    dispose(): Promise<void>;
    private clearDeviceState;
    private extractDeviceId;
    private markRestorePending;
    private restoreConfiguredBaseLoad;
    private readRestorePendingState;
    private ensureRestorePendingState;
    private getRestorePendingStateId;
    private evaluateCurrentSoc;
    private ensureBkwOperatingMode;
}
//# sourceMappingURL=bkwModeService.d.ts.map