import type { AdapterInstance, DeviceTouchEvent } from "../types/shared";
import type CommandService from "../commands/commandService";
import type DeviceRegistry from "../core/deviceRegistry";
import type Scheduler from "../core/scheduler";
import type StateManager from "../core/stateManager";
import type RequestClient from "./requestClient";
export default class CloudApiPoller {
  private readonly adapter;
  private readonly config;
  private readonly scheduler;
  private readonly stateManager;
  private readonly deviceRegistry;
  private readonly commandService;
  private readonly requestClient;
  private readonly onDeviceSeen;
  private infoIntervalHandle;
  private ccuIntervalHandle;
  private infoStartHandle;
  private ccuStartHandle;
  private infoRequestInFlight;
  private ccuRequestInFlight;
  private started;
  constructor(
    adapter: AdapterInstance,
    config: {
      ccuName: string;
      ccuIntervalMs: number;
    },
    scheduler: Scheduler,
    stateManager: StateManager,
    deviceRegistry: DeviceRegistry,
    commandService: CommandService,
    requestClient: RequestClient,
    onDeviceSeen: (deviceEvent: DeviceTouchEvent) => Promise<void>,
  );
  start(): Promise<void>;
  dispose(): Promise<void>;
  private pollInfo;
  private pollCcu;
  private fetchWithRetry;
}
//# sourceMappingURL=cloudApiPoller.d.ts.map
