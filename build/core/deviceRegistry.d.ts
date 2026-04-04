import type { AdapterInstance, DeviceTouchEvent } from "../types/shared";
import type StateManager from "./stateManager";
export default class DeviceRegistry {
  private readonly adapter;
  private readonly stateManager;
  private readonly inactiveAfterMs;
  private readonly activeDevices;
  private readonly subscribedSocStates;
  constructor(
    adapter: AdapterInstance,
    stateManager: StateManager,
    inactiveAfterMs?: number,
  );
  getActiveDeviceIds(): string[];
  getPrimaryDeviceId(): string | null;
  touch(deviceId: string): Promise<DeviceTouchEvent>;
  cleanupInactiveDevices(): Promise<{
    removedDeviceIds: string[];
    connectionLost: boolean;
  }>;
  reset(): Promise<void>;
  private subscribeSocState;
  private unsubscribeSocState;
}
//# sourceMappingURL=deviceRegistry.d.ts.map
