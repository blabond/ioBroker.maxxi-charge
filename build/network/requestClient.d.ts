import { type AxiosRequestConfig, type AxiosResponse, type RawAxiosRequestHeaders } from "axios";
import type { AdapterInstance, LogLevel } from "../types/shared";
interface RequestOptions {
    headers?: RawAxiosRequestHeaders;
    timeoutMs?: number;
    label?: string;
    logLevel?: LogLevel;
}
export default class RequestClient {
    private readonly adapter;
    private readonly client;
    constructor(adapter: AdapterInstance);
    get<T = unknown>(url: string, options?: RequestOptions): Promise<AxiosResponse<T>>;
    post<T = unknown>(url: string, data: unknown, options?: RequestOptions): Promise<AxiosResponse<T>>;
    request<T = unknown>(config: AxiosRequestConfig, options?: RequestOptions): Promise<AxiosResponse<T>>;
    private logRequestError;
}
export {};
//# sourceMappingURL=requestClient.d.ts.map