import type { AdapterInstance as IoBrokerAdapterInstance } from "@iobroker/adapter-core";
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}
export interface AdapterConfig {
  maxxiccuname?: string;
  ccuinterval?: string | number;
  port?: string | number;
  apimode?: string;
  localCloudMirror?: boolean | string | number;
  enableseasonmode?: boolean | string | number;
  winterfrom?: string;
  winterto?: string;
  batterycalibration?: boolean | string | number;
  calibrationProgress?: string;
  feedInMode?: string | number;
  bkw_enable?: boolean | string | number;
  bkw_powerTarget?: string | number;
  bkw_adjustment?: string | number;
}
export interface RuntimeConfig {
  apiMode: "local" | "cloud";
  ccuName: string;
  ccuIntervalMs: number;
  localPort: number;
  localCloudMirrorEnabled: boolean;
  seasonModeEnabled: boolean;
  winterFrom: DayMonth | null;
  winterTo: DayMonth | null;
  batteryCalibrationEnabled: boolean;
  calibrationProgress: "down" | "up";
  feedInMode: number;
  bkwEnabled: boolean;
  bkwPowerTarget: number;
  bkwAdjustment: number;
}
export interface DayMonth {
  day: number;
  month: number;
}
export interface DeviceTouchEvent {
  deviceId: string;
  isNewDevice: boolean;
  connectionBecameActive: boolean;
}
export type PrimitiveStateValue = ioBroker.StateValue;
export type StateChange = ioBroker.State | null | undefined;
export type AdapterInstance = IoBrokerAdapterInstance;
export interface ObjectDefinition {
  type: ioBroker.ObjectType;
  common: Record<string, unknown>;
  native: Record<string, unknown>;
}
export type LogLevel = "debug" | "info" | "warn" | "error";
//# sourceMappingURL=shared.d.ts.map
