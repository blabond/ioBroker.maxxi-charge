import * as utils from "@iobroker/adapter-core";
export default class MaxxiChargeAdapter extends utils.Adapter {
    private runtimeConfig;
    private scheduler;
    private stateManager;
    private deviceRegistry;
    private requestClient;
    private commandService;
    private ecoMode;
    private batteryMode;
    private bkwMode;
    private localApi;
    private cloudApi;
    private cleanupIntervalHandle;
    private shuttingDown;
    constructor(options?: Partial<utils.AdapterOptions>);
    private onReady;
    private onStateChange;
    private onUnload;
    private handleConnectionLost;
    private handleDeviceSeen;
    private isSocStateId;
    private dispose;
}
//# sourceMappingURL=adapter.d.ts.map