"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_http_1 = __importDefault(require("node:http"));
const node_https_1 = __importDefault(require("node:https"));
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
        if (typeof options.cause !== 'undefined') {
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
        super('Invalid JSON response received', {
            code: 'ERR_INVALID_JSON',
            status,
            responseData: responseText,
            cause,
        });
    }
}
class TimeoutRequestError extends RequestClientError {
    constructor(timeoutMs) {
        super(`timeout of ${timeoutMs}ms exceeded`, {
            code: 'ETIMEDOUT',
        });
    }
}
function stringifyResponseData(data) {
    if (typeof data === 'undefined') {
        return '';
    }
    if (typeof data === 'string') {
        return data.slice(0, 300);
    }
    try {
        return JSON.stringify(data).slice(0, 300);
    }
    catch {
        return '';
    }
}
function mergeHeaders(...sources) {
    const result = {};
    for (const source of sources) {
        if (!source) {
            continue;
        }
        if (source instanceof Headers) {
            for (const [key, value] of source.entries()) {
                result[key] = value;
            }
            continue;
        }
        if (Array.isArray(source)) {
            for (const [key, value] of source) {
                result[key] = value;
            }
            continue;
        }
        Object.assign(result, source);
    }
    return result;
}
function findHeaderKey(headers, name) {
    const normalizedName = name.toLowerCase();
    for (const key of Object.keys(headers)) {
        if (key.toLowerCase() === normalizedName) {
            return key;
        }
    }
    return null;
}
function isBodyInit(value) {
    if (typeof value === 'string' ||
        value instanceof URLSearchParams ||
        value instanceof ArrayBuffer ||
        ArrayBuffer.isView(value)) {
        return true;
    }
    if (typeof Blob !== 'undefined' && value instanceof Blob) {
        return true;
    }
    if (typeof FormData !== 'undefined' && value instanceof FormData) {
        return true;
    }
    if (typeof ReadableStream !== 'undefined' && value instanceof ReadableStream) {
        return true;
    }
    return false;
}
function buildRequestBody(data, headers) {
    if (typeof data === 'undefined') {
        return undefined;
    }
    if (isBodyInit(data)) {
        return data;
    }
    if (!findHeaderKey(headers, 'Content-Type')) {
        headers['Content-Type'] = 'application/json';
    }
    return JSON.stringify(data);
}
function isJsonContentType(contentType) {
    if (!contentType) {
        return false;
    }
    const normalizedContentType = contentType.toLowerCase();
    return normalizedContentType.includes('application/json') || normalizedContentType.includes('+json');
}
async function parseResponseData(response, responseType) {
    if (responseType === 'none' || response.status === 204 || response.status === 205) {
        return undefined;
    }
    const rawText = await response.text();
    if (!rawText) {
        return undefined;
    }
    if (responseType === 'text') {
        return rawText;
    }
    try {
        return JSON.parse(rawText);
    }
    catch (error) {
        if (responseType === 'json' || isJsonContentType(response.headers.get('Content-Type'))) {
            throw new InvalidJsonResponseError(response.status, rawText, error);
        }
        return rawText;
    }
}
function parseResponseText(rawText, status, contentType, responseType) {
    if (!rawText) {
        return undefined;
    }
    if (responseType === 'text') {
        return rawText;
    }
    try {
        return JSON.parse(rawText);
    }
    catch (error) {
        if (responseType === 'json' || isJsonContentType(contentType)) {
            throw new InvalidJsonResponseError(status, rawText, error);
        }
        return rawText;
    }
}
class RequestClient {
    adapter;
    fetchImpl;
    keepAliveHttpAgent = new node_http_1.default.Agent({ keepAlive: true });
    keepAliveHttpsAgent = new node_https_1.default.Agent({ keepAlive: true });
    constructor(adapter, fetchImpl = fetch) {
        this.adapter = adapter;
        this.fetchImpl = fetchImpl;
    }
    async get(url, options = {}) {
        return this.request({
            method: 'GET',
            url,
        }, options);
    }
    async post(url, data, options = {}) {
        return this.request({
            method: 'POST',
            url,
            data,
        }, options);
    }
    async request(config, options = {}) {
        const timeoutMs = options.timeoutMs ?? constants_1.REQUEST_TIMEOUT_MS;
        const headers = mergeHeaders(options.headers, config.headers);
        const requestData = typeof config.body !== 'undefined' ? config.body : config.data;
        const requestBody = buildRequestBody(requestData, headers);
        try {
            const responseType = options.responseType ?? config.responseType ?? 'auto';
            const transport = options.transport ?? 'fetch';
            if (transport === 'node') {
                return await this.requestWithNodeTransport(config, headers, requestBody, timeoutMs, responseType);
            }
            return await this.requestWithFetchTransport(config, headers, requestBody, timeoutMs, responseType);
        }
        catch (error) {
            this.logRequestError(options.label ?? config.url, error, options.logLevel);
            throw error;
        }
    }
    async requestWithFetchTransport(config, headers, requestBody, timeoutMs, responseType) {
        const controller = new AbortController();
        let timedOut = false;
        const timeoutHandle = this.startTimeout(() => {
            timedOut = true;
            controller.abort();
        }, timeoutMs);
        try {
            const requestInit = {
                method: config.method.toUpperCase(),
                headers: new Headers(headers),
                signal: controller.signal,
            };
            if (typeof requestBody !== 'undefined') {
                requestInit.body = requestBody;
            }
            const response = await this.fetchImpl(config.url, requestInit);
            const data = await parseResponseData(response, responseType);
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
            if (timedOut) {
                throw new TimeoutRequestError(timeoutMs);
            }
            throw error;
        }
        finally {
            this.clearTimeout(timeoutHandle);
        }
    }
    async requestWithNodeTransport(config, headers, requestBody, timeoutMs, responseType) {
        if (typeof requestBody !== 'undefined' &&
            typeof requestBody !== 'string' &&
            !(requestBody instanceof URLSearchParams)) {
            throw new RequestClientError('Node transport only supports string request bodies', {
                code: 'ERR_UNSUPPORTED_BODY',
            });
        }
        const url = new URL(config.url);
        const isHttps = url.protocol === 'https:';
        const requestModule = isHttps ? node_https_1.default : node_http_1.default;
        const requestBodyText = typeof requestBody === 'undefined'
            ? undefined
            : typeof requestBody === 'string'
                ? requestBody
                : requestBody.toString();
        const nodeHeaders = { ...headers };
        if (!findHeaderKey(nodeHeaders, 'Accept')) {
            nodeHeaders.Accept = 'application/json, text/plain, */*';
        }
        if (!findHeaderKey(nodeHeaders, 'User-Agent')) {
            nodeHeaders['User-Agent'] = 'iobroker.maxxi-charge';
        }
        if (!findHeaderKey(nodeHeaders, 'Accept-Encoding')) {
            nodeHeaders['Accept-Encoding'] = 'gzip, compress, deflate, br';
        }
        if (typeof requestBodyText !== 'undefined' && !findHeaderKey(nodeHeaders, 'Content-Length')) {
            nodeHeaders['Content-Length'] = String(Buffer.byteLength(requestBodyText, 'utf8'));
        }
        return await new Promise((resolve, reject) => {
            let timedOut = false;
            const request = requestModule.request({
                protocol: url.protocol,
                hostname: url.hostname,
                port: url.port || undefined,
                path: `${url.pathname}${url.search}`,
                method: config.method.toUpperCase(),
                headers: nodeHeaders,
                agent: isHttps ? this.keepAliveHttpsAgent : this.keepAliveHttpAgent,
            }, response => {
                const chunks = [];
                response.on('data', chunk => {
                    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
                });
                response.on('end', () => {
                    const rawText = Buffer.concat(chunks).toString('utf8');
                    const data = parseResponseText(rawText, response.statusCode ?? 0, typeof response.headers['content-type'] === 'string'
                        ? response.headers['content-type']
                        : null, responseType);
                    if (typeof response.statusCode !== 'number' ||
                        response.statusCode < 200 ||
                        response.statusCode >= 300) {
                        reject(new HttpStatusError(response.statusCode ?? 0, response.statusMessage ?? '', data));
                        return;
                    }
                    resolve({
                        data: data,
                        status: response.statusCode,
                        statusText: response.statusMessage ?? '',
                        headers: new Headers(Object.entries(response.headers)
                            .filter(([, value]) => typeof value === 'string')
                            .map(([key, value]) => [key, value])),
                        url: config.url,
                    });
                });
            });
            request.setTimeout(timeoutMs, () => {
                timedOut = true;
                request.destroy(new TimeoutRequestError(timeoutMs));
            });
            request.on('error', error => {
                if (timedOut && !(error instanceof RequestClientError)) {
                    reject(new TimeoutRequestError(timeoutMs));
                    return;
                }
                reject(error);
            });
            if (typeof requestBodyText !== 'undefined') {
                request.write(requestBodyText);
            }
            request.end();
        });
    }
    logRequestError(label, error, level = 'debug') {
        const logMethod = typeof this.adapter.log[level] === 'function' ? level : 'debug';
        if (!(error instanceof RequestClientError)) {
            this.adapter.log[logMethod](`${label} failed: ${String(error)}`);
            return;
        }
        const statusCode = error.status;
        const responseText = stringifyResponseData(error.responseData);
        const errorCode = error.code ? ` (${error.code})` : '';
        this.adapter.log[logMethod](`${label} failed${errorCode}: ${error.message}${statusCode ? ` | status=${statusCode}` : ''}${responseText ? ` | response=${responseText}` : ''}`);
    }
    startTimeout(callback, timeoutMs) {
        if (typeof this.adapter.setTimeout === 'function') {
            return this.adapter.setTimeout(callback, timeoutMs) ?? setTimeout(callback, timeoutMs);
        }
        return setTimeout(callback, timeoutMs);
    }
    clearTimeout(handle) {
        if (typeof this.adapter.clearTimeout === 'function') {
            this.adapter.clearTimeout(handle);
            return;
        }
        clearTimeout(handle);
    }
}
exports.default = RequestClient;
//# sourceMappingURL=requestClient.js.map