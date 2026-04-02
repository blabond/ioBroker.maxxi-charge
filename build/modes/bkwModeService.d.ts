import type {
  AdapterInstance,
  RuntimeConfig,
  StateChange,
} from "../types/shared";
import type CommandService from "../commands/commandService";
import type DeviceRegistry from "../core/deviceRegistry";
export default class BkwModeService {
  private readonly adapter;
  private readonly config;
  private readonly commandService;
  private readonly deviceRegistry;
  private lastState;
  constructor(
    adapter: AdapterInstance,
    config: RuntimeConfig,
    commandService: CommandService,
    deviceRegistry: DeviceRegistry,
  );
  handleConnectionLost(): void;
  handleSocChange(id: string, state: StateChange): Promise<void>;
  dispose(): Promise<void>;
  private extractDeviceId;
}
//# sourceMappingURL=bkwModeService.d.ts.map
