"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.nameToId = nameToId;
exports.normalizeDeviceId = normalizeDeviceId;
exports.validateInterval = validateInterval;
exports.clampNumber = clampNumber;
exports.parseInteger = parseInteger;
exports.parseBoolean = parseBoolean;
exports.sleep = sleep;
exports.isRecord = isRecord;
exports.extractRelativeId = extractRelativeId;
exports.normalizeIpAddress = normalizeIpAddress;
exports.serializeComparable = serializeComparable;
exports.areValuesEqual = areValuesEqual;
exports.buildComparableObjectDefinition = buildComparableObjectDefinition;
function nameToId(value) {
    return String(value ?? "").replace(/[^a-zA-Z0-9_-]/g, "_");
}
function normalizeDeviceId(value) {
    return nameToId(value).toLowerCase();
}
function validateInterval(value, min = 1_000, max = 3_600_000) {
    if (!Number.isFinite(value)) {
        return min;
    }
    if (value < min) {
        return min;
    }
    if (value > max) {
        return max;
    }
    return value;
}
function clampNumber(value, min, max) {
    if (!Number.isFinite(value)) {
        return null;
    }
    if (typeof min === "number" && value < min) {
        return min;
    }
    if (typeof max === "number" && value > max) {
        return max;
    }
    return value;
}
function parseInteger(value, fallback) {
    const parsed = Number.parseInt(String(value ?? ""), 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}
function parseBoolean(value) {
    if (typeof value === "boolean") {
        return value;
    }
    if (typeof value === "number") {
        return value === 1;
    }
    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        return (normalized === "true" ||
            normalized === "1" ||
            normalized === "yes" ||
            normalized === "on");
    }
    return false;
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function isRecord(value) {
    return typeof value === "object" && value !== null;
}
function extractRelativeId(namespace, fullId) {
    const prefix = `${namespace}.`;
    return fullId.startsWith(prefix) ? fullId.slice(prefix.length) : null;
}
function normalizeIpAddress(remoteAddress) {
    return typeof remoteAddress === "string"
        ? remoteAddress.replace(/^::ffff:/, "")
        : "";
}
function stableSerialize(value) {
    if (value === undefined) {
        return "undefined";
    }
    if (typeof value === "number" && Number.isNaN(value)) {
        return "NaN";
    }
    if (value === null ||
        typeof value === "boolean" ||
        typeof value === "number" ||
        typeof value === "string") {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map((entry) => stableSerialize(entry)).join(",")}]`;
    }
    if (!isRecord(value)) {
        return JSON.stringify({ unsupportedType: typeof value });
    }
    const keys = Object.keys(value).sort();
    return `{${keys
        .map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`)
        .join(",")}}`;
}
function serializeComparable(value) {
    return stableSerialize(value);
}
function areValuesEqual(left, right) {
    return (Object.is(left, right) || stableSerialize(left) === stableSerialize(right));
}
function buildComparableObjectDefinition(definition) {
    return stableSerialize(definition);
}
//# sourceMappingURL=helpers.js.map