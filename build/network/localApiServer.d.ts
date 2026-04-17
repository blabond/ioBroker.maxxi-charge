import type { AdapterInstance, DeviceTouchEvent } from '../types/shared';
import type DeviceRegistry from '../core/deviceRegistry';
import type StateManager from '../core/stateManager';
import type RequestClient from './requestClient';
export default class LocalApiServer {
    private readonly adapter;
    private readonly config;
    private readonly stateManager;
    private readonly deviceRegistry;
    private readonly requestClient;
    private readonly onDeviceSeen;
    private server;
    private readonly openSockets;
    private lastCloudMirrorErrorLogTs;
    private lastAbortedPeerWarningLogTs;
    private suppressedAbortedPeerWarnings;
    constructor(adapter: AdapterInstance, config: {
        localPort: number;
        localCloudMirrorEnabled: boolean;
    }, stateManager: StateManager, deviceRegistry: DeviceRegistry, requestClient: RequestClient, onDeviceSeen: (deviceEvent: DeviceTouchEvent) => Promise<void>);
    start(): Promise<void>;
    dispose(): Promise<void>;
    private handleRequest;
    private forwardPayloadToCloud;
}
//# sourceMappingURL=localApiServer.d.ts.map