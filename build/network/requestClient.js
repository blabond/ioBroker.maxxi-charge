"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const constants_1 = require("../constants");
class RequestClientError extends Error {
    code;
    status;
    responseData;
    constructor(message, options = {}) {
        super(message);
        this.name = new.target.name;
        this.code = options.code;
        this.status = options.status;
        this.responseData = options.responseData;
        if (typeof options.cause !== "undefined") {
            this.cause = options.cause;
        }
    }
}
class HttpStatusError extends RequestClientError {
    constructor(status, statusText, responseData) {
        super(`Request failed with status code ${status}`, {
            status,
            responseData,
        });
        this.statusText = statusText;
    }
    statusText;
}
class InvalidJsonResponseError extends RequestClientError {
    constructor(status, responseText, cause) {
        super("Invalid JSON response received", {
            code: "ERR_INVALID_JSON",
            status,
            responseData: responseText,
            cause,
        });
    }
}
class TimeoutRequestError extends RequestClientError {
    constructor(timeoutMs) {
        super(`timeout of ${timeoutMs}ms exceeded`, {
            code: "ETIMEDOUT",
        });
    }
}
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
function isBodyInit(value) {
    if (typeof value === "string" ||
        value instanceof URLSearchParams ||
        value instanceof ArrayBuffer ||
        ArrayBuffer.isView(value)) {
        return true;
    }
    if (typeof Blob !== "undefined" && value instanceof Blob) {
        return true;
    }
    if (typeof FormData !== "undefined" && value instanceof FormData) {
        return true;
    }
    if (typeof ReadableStream !== "undefined" &&
        value instanceof ReadableStream) {
        return true;
    }
    return false;
}
function buildRequestBody(data, headers) {
    if (typeof data === "undefined") {
        return undefined;
    }
    if (isBodyInit(data)) {
        return data;
    }
    if (!headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
    }
    return JSON.stringify(data);
}
function isJsonContentType(contentType) {
    if (!contentType) {
        return false;
    }
    const normalizedContentType = contentType.toLowerCase();
    return (normalizedContentType.includes("application/json") ||
        normalizedContentType.includes("+json"));
}
async function parseResponseData(response, responseType) {
    if (responseType === "none" ||
        response.status === 204 ||
        response.status === 205) {
        return undefined;
    }
    const rawText = await response.text();
    if (!rawText) {
        return undefined;
    }
    if (responseType === "text") {
        return rawText;
    }
    try {
        return JSON.parse(rawText);
    }
    catch (error) {
        if (responseType === "json" ||
            isJsonContentType(response.headers.get("Content-Type"))) {
            throw new InvalidJsonResponseError(response.status, rawText, error);
        }
        return rawText;
    }
}
class RequestClient {
    adapter;
    fetchImpl;
    constructor(adapter, fetchImpl = fetch) {
        this.adapter = adapter;
        this.fetchImpl = fetchImpl;
    }
    async get(url, options = {}) {
        return this.request({
            method: "GET",
            url,
        }, options);
    }
    async post(url, data, options = {}) {
        return this.request({
            method: "POST",
            url,
            data,
        }, options);
    }
    async request(config, options = {}) {
        const timeoutMs = options.timeoutMs ?? constants_1.REQUEST_TIMEOUT_MS;
        const controller = new AbortController();
        const headers = new Headers(options.headers);
        const configHeaders = new Headers(config.headers);
        const requestData = typeof config.body !== "undefined" ? config.body : config.data;
        let timedOut = false;
        for (const [key, value] of configHeaders.entries()) {
            headers.set(key, value);
        }
        const requestBody = buildRequestBody(requestData, headers);
        const timeoutHandle = setTimeout(() => {
            timedOut = true;
            controller.abort();
        }, timeoutMs);
        try {
            const requestInit = {
                method: config.method.toUpperCase(),
                headers,
                signal: controller.signal,
            };
            if (typeof requestBody !== "undefined") {
                requestInit.body = requestBody;
            }
            const response = await this.fetchImpl(config.url, requestInit);
            const data = await parseResponseData(response, options.responseType ?? config.responseType ?? "auto");
            if (!response.ok) {
                throw new HttpStatusError(response.status, response.statusText, data);
            }
            return {
                data: data,
                status: response.status,
                statusText: response.statusText,
                headers: response.headers,
                url: response.url,
            };
        }
        catch (error) {
            const normalizedError = timedOut
                ? new TimeoutRequestError(timeoutMs)
                : error;
            this.logRequestError(options.label ?? config.url, normalizedError, options.logLevel);
            throw normalizedError;
        }
        finally {
            clearTimeout(timeoutHandle);
        }
    }
    logRequestError(label, error, level = "debug") {
        const logMethod = typeof this.adapter.log[level] === "function" ? level : "debug";
        if (!(error instanceof RequestClientError)) {
            this.adapter.log[logMethod](`${label} failed: ${String(error)}`);
            return;
        }
        const statusCode = error.status;
        const responseText = stringifyResponseData(error.responseData);
        const errorCode = error.code ? ` (${error.code})` : "";
        this.adapter.log[logMethod](`${label} failed${errorCode}: ${error.message}${statusCode ? ` | status=${statusCode}` : ""}${responseText ? ` | response=${responseText}` : ""}`);
    }
}
exports.default = RequestClient;
//# sourceMappingURL=requestClient.js.map