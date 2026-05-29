"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeConfig = normalizeConfig;
const constants_1 = require("./constants");
const date_1 = require("./utils/date");
const helpers_1 = require("./utils/helpers");
function normalizeConfig(rawConfig) {
    const apiMode = rawConfig.apimode === 'cloud' ? 'cloud' : 'local';
    const ccuIntervalSeconds = (0, helpers_1.parseInteger)(rawConfig.ccuinterval, 5);
    const legacyCcuIntervalMs = (0, helpers_1.validateInterval)(ccuIntervalSeconds * 1_000, constants_1.CLOUD_CCU_MIN_INTERVAL_MS, 3_600_000);
    const port = (0, helpers_1.parseInteger)(rawConfig.port, 5501);
    const feedInMode = (0, helpers_1.parseInteger)(rawConfig.feedInMode, 95);
    const bkwPowerTarget = (0, helpers_1.parseInteger)(rawConfig.bkw_powerTarget, 600);
    const bkwAdjustment = (0, helpers_1.parseInteger)(rawConfig.bkw_adjustment, -35);
    return {
        apiMode,
        ccuName: String(rawConfig.maxxiccuname ?? '').trim(),
        // Cloud polling is fixed to 5 seconds. The adapter setting remains for legacy compatibility.
        ccuIntervalMs: apiMode === 'cloud' ? constants_1.CLOUD_CCU_INTERVAL_MS : legacyCcuIntervalMs,
        localPort: Math.min(Math.max(port, 1), 65_535),
        localCloudMirrorEnabled: (0, helpers_1.parseBoolean)(rawConfig.localCloudMirror),
        seasonModeEnabled: (0, helpers_1.parseBoolean)(rawConfig.enableseasonmode),
        winterFrom: (0, date_1.parseDayMonth)(rawConfig.winterfrom),
        winterTo: (0, date_1.parseDayMonth)(rawConfig.winterto),
        batteryCalibrationEnabled: (0, helpers_1.parseBoolean)(rawConfig.batterycalibration),
        calibrationProgress: rawConfig.calibrationProgress === 'up' ? 'up' : 'down',
        feedInMode: Math.min(Math.max(feedInMode, 20), 100),
        bkwEnabled: (0, helpers_1.parseBoolean)(rawConfig.bkw_enable),
        bkwPowerTarget: Math.min(Math.max(bkwPowerTarget, 0), 1000),
        bkwAdjustment: Math.min(Math.max(bkwAdjustment, -1000), 600),
    };
}
//# sourceMappingURL=config.js.map