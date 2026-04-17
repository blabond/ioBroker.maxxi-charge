import type { AdapterInstance, LogLevel } from '../types/shared';
type ResponseType = 'auto' | 'json' | 'text' | 'none';
type RequestTransport = 'fetch' | 'node';
type RequestHeaders = Headers | Record<string, string> | Array<[string, string]>;
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
export default class RequestClient {
    private readonly adapter;
    private readonly fetchImpl;
    private readonly keepAliveHttpAgent;
    private readonly keepAliveHttpsAgent;
    constructor(adapter: AdapterInstance, fetchImpl?: typeof fetch);
    get<T = unknown>(url: string, options?: RequestOptions): Promise<RequestClientResponse<T>>;
    post<T = unknown>(url: string, data: unknown, options?: RequestOptions): Promise<RequestClientResponse<T>>;
    request<T = unknown>(config: RequestConfig, options?: RequestOptions): Promise<RequestClientResponse<T>>;
    private requestWithFetchTransport;
    private requestWithNodeTransport;
    private logRequestError;
    private startTimeout;
    private clearTimeout;
}
export {};
//# sourceMappingURL=requestClient.d.ts.map