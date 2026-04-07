import { type RuntimeConfig, type AdapterConfig } from "./types/shared";
import { CLOUD_CCU_INTERVAL_MS, CLOUD_CCU_MIN_INTERVAL_MS } from "./constants";
import { parseDayMonth } from "./utils/date";
import { parseBoolean, parseInteger, validateInterval } from "./utils/helpers";

export function normalizeConfig(rawConfig: AdapterConfig): RuntimeConfig {
  const apiMode = rawConfig.apimode === "cloud" ? "cloud" : "local";
  const ccuIntervalSeconds = parseInteger(rawConfig.ccuinterval, 5);
  const legacyCcuIntervalMs = validateInterval(
    ccuIntervalSeconds * 1_000,
    CLOUD_CCU_MIN_INTERVAL_MS,
    3_600_000,
  );
  const port = parseInteger(rawConfig.port, 5501);
  const feedInMode = parseInteger(rawConfig.feedInMode, 95);
  const bkwPowerTarget = parseInteger(rawConfig.bkw_powerTarget, 600);
  const bkwAdjustment = parseInteger(rawConfig.bkw_adjustment, -35);

  return {
    apiMode,
    ccuName: String(rawConfig.maxxiccuname ?? "").trim(),
    // Cloud polling is fixed to 5 seconds. The adapter setting remains for legacy compatibility.
    ccuIntervalMs:
      apiMode === "cloud" ? CLOUD_CCU_INTERVAL_MS : legacyCcuIntervalMs,
    localPort: Math.min(Math.max(port, 1), 65_535),
    localCloudMirrorEnabled: parseBoolean(rawConfig.localCloudMirror),
    seasonModeEnabled: parseBoolean(rawConfig.enableseasonmode),
    winterFrom: parseDayMonth(rawConfig.winterfrom),
    winterTo: parseDayMonth(rawConfig.winterto),
    batteryCalibrationEnabled: parseBoolean(rawConfig.batterycalibration),
    calibrationProgress: rawConfig.calibrationProgress === "up" ? "up" : "down",
    feedInMode: Math.min(Math.max(feedInMode, 20), 100),
    bkwEnabled: parseBoolean(rawConfig.bkw_enable),
    bkwPowerTarget: Math.min(Math.max(bkwPowerTarget, 0), 2300),
    bkwAdjustment: Math.min(Math.max(bkwAdjustment, -1000), 600),
  };
}
