import type { AdapterInstance, RuntimeConfig, StateChange } from "../types/shared";
import type CommandService from "../commands/commandService";
import type DeviceRegistry from "../core/deviceRegistry";
import type Scheduler from "../core/scheduler";
export default class EcoModeService {
    private readonly adapter;
    private readonly config;
    private readonly scheduler;
    private readonly commandService;
    private readonly deviceRegistry;
    private dailyJob;
    private readonly minSocSetTodayByDevice;
    private started;
    constructor(adapter: AdapterInstance, config: RuntimeConfig, scheduler: Scheduler, commandService: CommandService, deviceRegistry: DeviceRegistry);
    start(): Promise<void>;
    handleDeviceAvailable(deviceId: string): Promise<void>;
    handleDeviceInactive(deviceId: string): void;
    handleConnectionLost(): void;
    handleSocChange(id: string, state: StateChange): Promise<void>;
    dispose(): Promise<void>;
    private evaluateActiveDevices;
    private evaluateSeason;
    private applySummerSettings;
    private getTodayValue;
    private extractDeviceId;
}
//# sourceMappingURL=ecoModeService.d.ts.map