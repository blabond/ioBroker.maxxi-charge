"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const axios_1 = __importDefault(require("axios"));
const constants_1 = require("../constants");
function stringifyResponseData(data) {
    if (typeof data === "undefined") {
        return "";
    }
    if (typeof data === "string") {
        return data.slice(0, 300);
    }
    try {
        return JSON.stringify(data).slice(0, 300);
    }
    catch {
        return "";
    }
}
class RequestClient {
    adapter;
    client;
    constructor(adapter) {
        this.adapter = adapter;
        this.client = axios_1.default.create({
            validateStatus: (status) => status >= 200 && status < 300,
        });
    }
    async get(url, options = {}) {
        return this.request({
            method: "get",
            url,
        }, options);
    }
    async post(url, data, options = {}) {
        const config = {
            method: "post",
            url,
            data,
        };
        if (options.headers) {
            config.headers = options.headers;
        }
        return this.request(config, options);
    }
    async request(config, options = {}) {
        const timeoutMs = options.timeoutMs ?? constants_1.REQUEST_TIMEOUT_MS;
        try {
            return await this.client.request({
                ...config,
                timeout: timeoutMs,
                signal: AbortSignal.timeout(timeoutMs),
            });
        }
        catch (error) {
            this.logRequestError(options.label ?? config.url ?? "request", error, options.logLevel);
            throw error;
        }
    }
    logRequestError(label, error, level = "debug") {
        const logMethod = typeof this.adapter.log[level] === "function" ? level : "debug";
        if (!axios_1.default.isAxiosError(error)) {
            this.adapter.log[logMethod](`${label} failed: ${String(error)}`);
            return;
        }
        const statusCode = error.response?.status;
        const responseText = stringifyResponseData(error.response?.data);
        const errorCode = error.code ? ` (${error.code})` : "";
        this.adapter.log[logMethod](`${label} failed${errorCode}: ${error.message}${statusCode ? ` | status=${statusCode}` : ""}${responseText ? ` | response=${responseText}` : ""}`);
    }
}
exports.default = RequestClient;
//# sourceMappingURL=requestClient.js.map