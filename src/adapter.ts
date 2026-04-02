import * as utils from "@iobroker/adapter-core";
import CommandService from "./commands/commandService";
import { normalizeConfig } from "./config";
import { ACTIVE_DEVICE_CLEANUP_INTERVAL_MS } from "./constants";
import DeviceRegistry from "./core/deviceRegistry";
import Scheduler from "./core/scheduler";
import StateManager from "./core/stateManager";
import BatteryModeService from "./modes/batteryModeService";
import BkwModeService from "./modes/bkwModeService";
import EcoModeService from "./modes/ecoModeService";
import CloudApiPoller from "./network/cloudApiPoller";
import LocalApiServer from "./network/localApiServer";
import RequestClient from "./network/requestClient";
import type {
  AdapterConfig,
  DeviceTouchEvent,
  RuntimeConfig,
  StateChange,
} from "./types/shared";
import { extractRelativeId } from "./utils/helpers";

export default class MaxxiChargeAdapter extends utils.Adapter {
  private runtimeConfig: RuntimeConfig | null = null;

  private scheduler: Scheduler | null = null;

  private stateManager: StateManager | null = null;

  private deviceRegistry: DeviceRegistry | null = null;

  private requestClient: RequestClient | null = null;

  private commandService: CommandService | null = null;

  private ecoMode: EcoModeService | null = null;

  private batteryMode: BatteryModeService | null = null;

  private bkwMode: BkwModeService | null = null;

  private localApi: LocalApiServer | null = null;

  private cloudApi: CloudApiPoller | null = null;

  private cleanupIntervalHandle: ioBroker.Interval = null;

  private shuttingDown = false;

  public constructor(options: Partial<utils.AdapterOptions> = {}) {
    super({
      ...options,
      name: "maxxi-charge",
    });

    this.on("ready", this.onReady.bind(this));
    this.on("stateChange", this.onStateChange.bind(this));
    this.on("unload", this.onUnload.bind(this));
  }

  private async onReady(): Promise<void> {
    try {
      this.runtimeConfig = normalizeConfig(this.config as AdapterConfig);
      this.scheduler = new Scheduler(this);
      this.stateManager = new StateManager(this);
      this.requestClient = new RequestClient(this);
      this.deviceRegistry = new DeviceRegistry(this, this.stateManager);
      this.commandService = new CommandService(
        this,
        this.stateManager,
        this.requestClient,
      );
      this.ecoMode = new EcoModeService(
        this,
        this.runtimeConfig,
        this.scheduler,
        this.commandService,
        this.deviceRegistry,
      );
      this.batteryMode = new BatteryModeService(
        this,
        this.runtimeConfig,
        this.commandService,
        this.deviceRegistry,
      );
      this.bkwMode = new BkwModeService(
        this,
        this.runtimeConfig,
        this.commandService,
        this.deviceRegistry,
      );

      await this.stateManager.ensureInfoStructure();
      await this.stateManager.resetInfoStates();

      if (this.runtimeConfig.apiMode === "local") {
        this.localApi = new LocalApiServer(
          this,
          this.runtimeConfig,
          this.stateManager,
          this.deviceRegistry,
          this.commandService,
          this.requestClient,
          this.handleDeviceSeen.bind(this),
        );
        await this.localApi.start();
      } else {
        this.cloudApi = new CloudApiPoller(
          this,
          this.runtimeConfig,
          this.scheduler,
          this.stateManager,
          this.deviceRegistry,
          this.commandService,
          this.requestClient,
          this.handleDeviceSeen.bind(this),
        );
        await this.cloudApi.start();
      }

      await this.ecoMode.start();
      await this.batteryMode.start();

      this.cleanupIntervalHandle = this.scheduler.setInterval(
        async () => {
          const cleanupResult =
            await this.deviceRegistry?.cleanupInactiveDevices();
          if (cleanupResult?.connectionLost) {
            this.handleConnectionLost();
          }
        },
        ACTIVE_DEVICE_CLEANUP_INTERVAL_MS,
        "active-device-cleanup",
      );
    } catch (error) {
      this.log.error(
        `Fatal error during initialization: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      await this.dispose();
    }
  }

  private async onStateChange(id: string, state: StateChange): Promise<void> {
    if (!state || this.shuttingDown || !this.commandService) {
      return;
    }

    try {
      if (!state.ack) {
        const wasHandled = await this.commandService.handleStateChange(
          id,
          state,
        );
        if (wasHandled) {
          return;
        }
      }

      if (!state.ack || !this.isSocStateId(id)) {
        return;
      }

      await this.ecoMode?.handleSocChange(id, state);
      await this.batteryMode?.handleSocChange(id, state);
      await this.bkwMode?.handleSocChange(id, state);
    } catch (error) {
      this.log.error(
        `Error while processing state ${id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async onUnload(callback: () => void): Promise<void> {
    this.shuttingDown = true;

    try {
      await this.dispose();
    } catch (error) {
      this.log.error(
        `Error during shutdown: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    callback();
  }

  private handleConnectionLost(): void {
    this.ecoMode?.handleConnectionLost();
    this.batteryMode?.handleConnectionLost();
    this.bkwMode?.handleConnectionLost();
  }

  private async handleDeviceSeen(deviceEvent: DeviceTouchEvent): Promise<void> {
    if (!deviceEvent.deviceId) {
      return;
    }

    if (!deviceEvent.isNewDevice && !deviceEvent.connectionBecameActive) {
      return;
    }

    try {
      await this.ecoMode?.handleDeviceAvailable(deviceEvent.deviceId);
      await this.batteryMode?.handleDeviceAvailable(deviceEvent.deviceId);
    } catch (error) {
      this.log.error(
        `Error while handling device activation for ${deviceEvent.deviceId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private isSocStateId(fullId: string): boolean {
    const relativeId = extractRelativeId(this.namespace, fullId);
    return Boolean(relativeId && relativeId.endsWith(".SOC"));
  }

  private async dispose(): Promise<void> {
    const disposals: Promise<void>[] = [];

    if (this.cleanupIntervalHandle && this.scheduler) {
      this.scheduler.clearInterval(this.cleanupIntervalHandle);
      this.cleanupIntervalHandle = null;
    }

    if (this.localApi) {
      disposals.push(this.localApi.dispose());
      this.localApi = null;
    }

    if (this.cloudApi) {
      disposals.push(this.cloudApi.dispose());
      this.cloudApi = null;
    }

    if (this.ecoMode) {
      disposals.push(this.ecoMode.dispose());
    }

    if (this.batteryMode) {
      disposals.push(this.batteryMode.dispose());
    }

    if (this.bkwMode) {
      disposals.push(this.bkwMode.dispose());
    }

    if (this.commandService) {
      disposals.push(this.commandService.dispose());
    }

    await Promise.allSettled(disposals);

    if (this.scheduler) {
      await this.scheduler.dispose();
    }

    if (this.deviceRegistry) {
      await this.deviceRegistry.reset();
    } else {
      await this.stateManager?.resetInfoStates();
    }

    this.stateManager?.clearCaches();
  }
}
