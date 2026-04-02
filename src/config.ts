import { type RuntimeConfig, type AdapterConfig } from "./types/shared";
import { parseDayMonth } from "./utils/date";
import { parseBoolean, parseInteger, validateInterval } from "./utils/helpers";

export function normalizeConfig(rawConfig: AdapterConfig): RuntimeConfig {
  const ccuIntervalSeconds = parseInteger(rawConfig.ccuinterval, 10);
  const port = parseInteger(rawConfig.port, 5501);
  const feedInMode = parseInteger(rawConfig.feedInMode, 97);
  const bkwPowerTarget = parseInteger(rawConfig.bkw_powerTarget, 600);
  const bkwAdjustment = parseInteger(rawConfig.bkw_adjustment, -35);

  return {
    apiMode: rawConfig.apimode === "cloud" ? "cloud" : "local",
    ccuName: String(rawConfig.maxxiccuname ?? "").trim(),
    ccuIntervalMs: validateInterval(
      ccuIntervalSeconds * 1_000,
      10_000,
      3_600_000,
    ),
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
    bkwAdjustment: Math.min(Math.max(bkwAdjustment, -600), 600),
  };
}
