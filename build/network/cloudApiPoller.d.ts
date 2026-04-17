import type { AdapterInstance, DeviceTouchEvent } from '../types/shared';
import type DeviceRegistry from '../core/deviceRegistry';
import type Scheduler from '../core/scheduler';
import type StateManager from '../core/stateManager';
import type RequestClient from './requestClient';
export default class CloudApiPoller {
    private readonly adapter;
    private readonly config;
    private readonly scheduler;
    private readonly stateManager;
    private readonly deviceRegistry;
    private readonly requestClient;
    private readonly onDeviceSeen;
    private infoIntervalHandle;
    private ccuIntervalHandle;
    private infoStartHandle;
    private ccuStartHandle;
    private infoRequestInFlight;
    private ccuRequestInFlight;
    private started;
    private readonly failureLogStateByKey;
    constructor(
        adapter: AdapterInstance,
        config: {
            ccuName: string;
            ccuIntervalMs: number;
        },
        scheduler: Scheduler,
        stateManager: StateManager,
        deviceRegistry: DeviceRegistry,
        requestClient: RequestClient,
        onDeviceSeen: (deviceEvent: DeviceTouchEvent) => Promise<void>,
    );
    start(): Promise<void>;
    dispose(): Promise<void>;
    private pollInfo;
    private pollCcu;
    private fetchWithRetry;
    private clearFailureLogState;
    private logThrottledFailure;
}
//# sourceMappingURL=cloudApiPoller.d.ts.map
