import type { AdapterInstance, RuntimeConfig, StateChange } from '../types/shared';
import type CommandService from '../commands/commandService';
import type DeviceRegistry from '../core/deviceRegistry';
export default class BatteryModeService {
    private readonly adapter;
    private readonly config;
    private readonly commandService;
    private readonly deviceRegistry;
    private readonly calibrationAppliedDeviceIds;
    constructor(
        adapter: AdapterInstance,
        config: RuntimeConfig,
        commandService: CommandService,
        deviceRegistry: DeviceRegistry,
    );
    start(): Promise<void>;
    handleDeviceAvailable(deviceId: string): Promise<void>;
    handleDeviceInactive(deviceId: string): void;
    handleConnectionLost(): void;
    handleSocChange(id: string, state: StateChange): Promise<void>;
    dispose(): Promise<void>;
    private applyCalibrationToDevices;
    private extractDeviceId;
    private applyCalibration;
    private updateCalibrationState;
}
//# sourceMappingURL=batteryModeService.d.ts.map
