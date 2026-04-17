import http from 'node:http';
import https from 'node:https';
import { REQUEST_TIMEOUT_MS } from '../constants';
import type { AdapterInstance, LogLevel } from '../types/shared';

type ResponseType = 'auto' | 'json' | 'text' | 'none';
type RequestTransport = 'fetch' | 'node';
type RequestHeaders = Headers | Record<string, string> | Array<[string, string]>;
type RequestBody = string | URLSearchParams | ArrayBuffer | ArrayBufferView | Blob | FormData | ReadableStream;

interface RequestConfig {
    method: string;
    url: string;
    headers?: RequestHeaders;
    body?: unknown;
    data?: unknown;
    responseType?: ResponseType;
}

interface RequestOptions {
    headers?: RequestHeaders;
    timeoutMs?: number;
    label?: string;
    logLevel?: LogLevel;
    responseType?: ResponseType;
    transport?: RequestTransport;
}

export interface RequestClientResponse<T = unknown> {
    data: T;
    status: number;
    statusText: string;
    headers: Headers;
    url: string;
}

class RequestClientError extends Error {
    public readonly code: string | undefined;
    public readonly status: number | undefined;
    public readonly responseData: unknown;

    public constructor(
        message: string,
        options: {
            code?: string;
            status?: number;
            responseData?: unknown;
            cause?: unknown;
        } = {},
    ) {
        super(message);
        this.name = new.target.name;
        this.code = options.code;
        this.status = options.status;
        this.responseData = options.responseData;

        if (typeof options.cause !== 'undefined') {
            (this as Error & { cause?: unknown }).cause = options.cause;
        }
    }
}

class HttpStatusError extends RequestClientError {
    public constructor(status: number, statusText: string, responseData: unknown) {
        super(`Request failed with status code ${status}`, {
            status,
            responseData,
        });
        this.statusText = statusText;
    }

    public readonly statusText: string;
}

class InvalidJsonResponseError extends RequestClientError {
    public constructor(status: number, responseText: string, cause: unknown) {
        super('Invalid JSON response received', {
            code: 'ERR_INVALID_JSON',
            status,
            responseData: responseText,
            cause,
        });
    }
}

class TimeoutRequestError extends RequestClientError {
    public constructor(timeoutMs: number) {
        super(`timeout of ${timeoutMs}ms exceeded`, {
            code: 'ETIMEDOUT',
        });
    }
}

function stringifyResponseData(data: unknown): string {
    if (typeof data === 'undefined') {
        return '';
    }

    if (typeof data === 'string') {
        return data.slice(0, 300);
    }

    try {
        return JSON.stringify(data).slice(0, 300);
    } catch {
        return '';
    }
}

function mergeHeaders(...sources: Array<RequestHeaders | undefined>): Record<string, string> {
    const result: Record<string, string> = {};

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

function findHeaderKey(headers: Record<string, string>, name: string): string | null {
    const normalizedName = name.toLowerCase();

    for (const key of Object.keys(headers)) {
        if (key.toLowerCase() === normalizedName) {
            return key;
        }
    }

    return null;
}

function isBodyInit(value: unknown): value is RequestBody {
    if (
        typeof value === 'string' ||
        value instanceof URLSearchParams ||
        value instanceof ArrayBuffer ||
        ArrayBuffer.isView(value)
    ) {
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

function buildRequestBody(data: unknown, headers: Record<string, string>): RequestBody | undefined {
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

function isJsonContentType(contentType: string | null): boolean {
    if (!contentType) {
        return false;
    }

    const normalizedContentType = contentType.toLowerCase();
    return normalizedContentType.includes('application/json') || normalizedContentType.includes('+json');
}

async function parseResponseData(response: Response, responseType: ResponseType): Promise<unknown> {
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
    } catch (error) {
        if (responseType === 'json' || isJsonContentType(response.headers.get('Content-Type'))) {
            throw new InvalidJsonResponseError(response.status, rawText, error);
        }

        return rawText;
    }
}

function parseResponseText(
    rawText: string,
    status: number,
    contentType: string | null,
    responseType: ResponseType,
): unknown {
    if (!rawText) {
        return undefined;
    }

    if (responseType === 'text') {
        return rawText;
    }

    try {
        return JSON.parse(rawText);
    } catch (error) {
        if (responseType === 'json' || isJsonContentType(contentType)) {
            throw new InvalidJsonResponseError(status, rawText, error);
        }

        return rawText;
    }
}

export default class RequestClient {
    private readonly keepAliveHttpAgent = new http.Agent({ keepAlive: true });
    private readonly keepAliveHttpsAgent = new https.Agent({ keepAlive: true });

    public constructor(
        private readonly adapter: AdapterInstance,
        private readonly fetchImpl: typeof fetch = fetch,
    ) {}

    public async get<T = unknown>(url: string, options: RequestOptions = {}): Promise<RequestClientResponse<T>> {
        return this.request<T>(
            {
                method: 'GET',
                url,
            },
            options,
        );
    }

    public async post<T = unknown>(
        url: string,
        data: unknown,
        options: RequestOptions = {},
    ): Promise<RequestClientResponse<T>> {
        return this.request<T>(
            {
                method: 'POST',
                url,
                data,
            },
            options,
        );
    }

    public async request<T = unknown>(
        config: RequestConfig,
        options: RequestOptions = {},
    ): Promise<RequestClientResponse<T>> {
        const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
        const headers = mergeHeaders(options.headers, config.headers);
        const requestData = typeof config.body !== 'undefined' ? config.body : config.data;
        const requestBody = buildRequestBody(requestData, headers);

        try {
            const responseType = options.responseType ?? config.responseType ?? 'auto';
            const transport = options.transport ?? 'fetch';

            if (transport === 'node') {
                return await this.requestWithNodeTransport<T>(config, headers, requestBody, timeoutMs, responseType);
            }

            return await this.requestWithFetchTransport<T>(config, headers, requestBody, timeoutMs, responseType);
        } catch (error) {
            this.logRequestError(options.label ?? config.url, error, options.logLevel);
            throw error;
        }
    }

    private async requestWithFetchTransport<T>(
        config: RequestConfig,
        headers: Record<string, string>,
        requestBody: RequestBody | undefined,
        timeoutMs: number,
        responseType: ResponseType,
    ): Promise<RequestClientResponse<T>> {
        const controller = new AbortController();
        let timedOut = false;

        const timeoutHandle = setTimeout(() => {
            timedOut = true;
            controller.abort();
        }, timeoutMs);

        try {
            const requestInit: RequestInit = {
                method: config.method.toUpperCase(),
                headers: new Headers(headers),
                signal: controller.signal,
            };

            if (typeof requestBody !== 'undefined') {
                requestInit.body = requestBody as NonNullable<RequestInit['body']>;
            }

            const response = await this.fetchImpl(config.url, requestInit);

            const data = await parseResponseData(response, responseType);

            if (!response.ok) {
                throw new HttpStatusError(response.status, response.statusText, data);
            }

            return {
                data: data as T,
                status: response.status,
                statusText: response.statusText,
                headers: response.headers,
                url: response.url,
            };
        } catch (error) {
            if (timedOut) {
                throw new TimeoutRequestError(timeoutMs);
            }

            throw error;
        } finally {
            clearTimeout(timeoutHandle);
        }
    }

    private async requestWithNodeTransport<T>(
        config: RequestConfig,
        headers: Record<string, string>,
        requestBody: RequestBody | undefined,
        timeoutMs: number,
        responseType: ResponseType,
    ): Promise<RequestClientResponse<T>> {
        if (
            typeof requestBody !== 'undefined' &&
            typeof requestBody !== 'string' &&
            !(requestBody instanceof URLSearchParams)
        ) {
            throw new RequestClientError('Node transport only supports string request bodies', {
                code: 'ERR_UNSUPPORTED_BODY',
            });
        }

        const url = new URL(config.url);
        const isHttps = url.protocol === 'https:';
        const requestModule = isHttps ? https : http;
        const requestBodyText =
            typeof requestBody === 'undefined'
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

        return await new Promise<RequestClientResponse<T>>((resolve, reject) => {
            let timedOut = false;

            const request = requestModule.request(
                {
                    protocol: url.protocol,
                    hostname: url.hostname,
                    port: url.port || undefined,
                    path: `${url.pathname}${url.search}`,
                    method: config.method.toUpperCase(),
                    headers: nodeHeaders,
                    agent: isHttps ? this.keepAliveHttpsAgent : this.keepAliveHttpAgent,
                },
                response => {
                    const chunks: Buffer[] = [];

                    response.on('data', chunk => {
                        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
                    });

                    response.on('end', () => {
                        const rawText = Buffer.concat(chunks).toString('utf8');
                        const data = parseResponseText(
                            rawText,
                            response.statusCode ?? 0,
                            typeof response.headers['content-type'] === 'string'
                                ? response.headers['content-type']
                                : null,
                            responseType,
                        );

                        if (
                            typeof response.statusCode !== 'number' ||
                            response.statusCode < 200 ||
                            response.statusCode >= 300
                        ) {
                            reject(new HttpStatusError(response.statusCode ?? 0, response.statusMessage ?? '', data));
                            return;
                        }

                        resolve({
                            data: data as T,
                            status: response.statusCode,
                            statusText: response.statusMessage ?? '',
                            headers: new Headers(
                                Object.entries(response.headers)
                                    .filter(([, value]) => typeof value === 'string')
                                    .map(([key, value]) => [key, value as string]),
                            ),
                            url: config.url,
                        });
                    });
                },
            );

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

    private logRequestError(label: string, error: unknown, level: LogLevel = 'debug'): void {
        const logMethod = typeof this.adapter.log[level] === 'function' ? level : 'debug';

        if (!(error instanceof RequestClientError)) {
            this.adapter.log[logMethod](`${label} failed: ${String(error)}`);
            return;
        }

        const statusCode = error.status;
        const responseText = stringifyResponseData(error.responseData);
        const errorCode = error.code ? ` (${error.code})` : '';

        this.adapter.log[logMethod](
            `${label} failed${errorCode}: ${error.message}${
                statusCode ? ` | status=${statusCode}` : ''
            }${responseText ? ` | response=${responseText}` : ''}`,
        );
    }
}
