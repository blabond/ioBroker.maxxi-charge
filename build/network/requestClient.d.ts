import type { AdapterInstance, LogLevel } from "../types/shared";
type ResponseType = "auto" | "json" | "text" | "none";
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
    constructor(adapter: AdapterInstance, fetchImpl?: typeof fetch);
    get<T = unknown>(url: string, options?: RequestOptions): Promise<RequestClientResponse<T>>;
    post<T = unknown>(url: string, data: unknown, options?: RequestOptions): Promise<RequestClientResponse<T>>;
    request<T = unknown>(config: RequestConfig, options?: RequestOptions): Promise<RequestClientResponse<T>>;
    private logRequestError;
}
export {};
//# sourceMappingURL=requestClient.d.ts.map