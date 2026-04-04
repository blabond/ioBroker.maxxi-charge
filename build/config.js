"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeConfig = normalizeConfig;
const date_1 = require("./utils/date");
const helpers_1 = require("./utils/helpers");
function normalizeConfig(rawConfig) {
  const ccuIntervalSeconds = (0, helpers_1.parseInteger)(
    rawConfig.ccuinterval,
    10,
  );
  const port = (0, helpers_1.parseInteger)(rawConfig.port, 5501);
  const feedInMode = (0, helpers_1.parseInteger)(rawConfig.feedInMode, 97);
  const bkwPowerTarget = (0, helpers_1.parseInteger)(
    rawConfig.bkw_powerTarget,
    600,
  );
  const bkwAdjustment = (0, helpers_1.parseInteger)(
    rawConfig.bkw_adjustment,
    -35,
  );
  return {
    apiMode: rawConfig.apimode === "cloud" ? "cloud" : "local",
    ccuName: String(rawConfig.maxxiccuname ?? "").trim(),
    ccuIntervalMs: (0, helpers_1.validateInterval)(
      ccuIntervalSeconds * 1_000,
      10_000,
      3_600_000,
    ),
    localPort: Math.min(Math.max(port, 1), 65_535),
    localCloudMirrorEnabled: (0, helpers_1.parseBoolean)(
      rawConfig.localCloudMirror,
    ),
    seasonModeEnabled: (0, helpers_1.parseBoolean)(rawConfig.enableseasonmode),
    winterFrom: (0, date_1.parseDayMonth)(rawConfig.winterfrom),
    winterTo: (0, date_1.parseDayMonth)(rawConfig.winterto),
    batteryCalibrationEnabled: (0, helpers_1.parseBoolean)(
      rawConfig.batterycalibration,
    ),
    calibrationProgress: rawConfig.calibrationProgress === "up" ? "up" : "down",
    feedInMode: Math.min(Math.max(feedInMode, 20), 100),
    bkwEnabled: (0, helpers_1.parseBoolean)(rawConfig.bkw_enable),
    bkwPowerTarget: Math.min(Math.max(bkwPowerTarget, 0), 2300),
    bkwAdjustment: Math.min(Math.max(bkwAdjustment, -1200), 600),
  };
}
//# sourceMappingURL=config.js.map
