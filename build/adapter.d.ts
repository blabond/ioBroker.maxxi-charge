import * as utils from '@iobroker/adapter-core';
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
    private disposePromise;
    private shuttingDown;
    constructor(options?: Partial<utils.AdapterOptions>);
    private onReady;
    private onStateChange;
    private onMessage;
    private onUnload;
    private handleConnectionLost;
    private handleDeviceInactive;
    private handleDeviceSeen;
    private isSocStateId;
    private buildLocalApiRoute;
    private getPreferredIpv4Address;
    private getLocalIpv4Addresses;
    private extractLocalApiPort;
    private isRecord;
    private dispose;
    private performDispose;
    private failInitialization;
}
//# sourceMappingURL=adapter.d.ts.map
