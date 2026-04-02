import axios, {
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosResponse,
  type RawAxiosRequestHeaders,
} from "axios";
import { REQUEST_TIMEOUT_MS } from "../constants";
import type { AdapterInstance, LogLevel } from "../types/shared";

interface RequestOptions {
  headers?: RawAxiosRequestHeaders;
  timeoutMs?: number;
  label?: string;
  logLevel?: LogLevel;
}

function stringifyResponseData(data: unknown): string {
  if (typeof data === "undefined") {
    return "";
  }

  if (typeof data === "string") {
    return data.slice(0, 300);
  }

  try {
    return JSON.stringify(data).slice(0, 300);
  } catch {
    return "";
  }
}

export default class RequestClient {
  private readonly client: AxiosInstance;

  public constructor(private readonly adapter: AdapterInstance) {
    this.client = axios.create({
      validateStatus: (status) => status >= 200 && status < 300,
    });
  }

  public async get<T = unknown>(
    url: string,
    options: RequestOptions = {},
  ): Promise<AxiosResponse<T>> {
    return this.request<T>(
      {
        method: "get",
        url,
      },
      options,
    );
  }

  public async post<T = unknown>(
    url: string,
    data: unknown,
    options: RequestOptions = {},
  ): Promise<AxiosResponse<T>> {
    const config: AxiosRequestConfig = {
      method: "post",
      url,
      data,
    };

    if (options.headers) {
      config.headers = options.headers;
    }

    return this.request<T>(config, options);
  }

  public async request<T = unknown>(
    config: AxiosRequestConfig,
    options: RequestOptions = {},
  ): Promise<AxiosResponse<T>> {
    const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;

    try {
      return await this.client.request<T>({
        ...config,
        timeout: timeoutMs,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      this.logRequestError(
        options.label ?? config.url ?? "request",
        error,
        options.logLevel,
      );
      throw error;
    }
  }

  private logRequestError(
    label: string,
    error: unknown,
    level: LogLevel = "debug",
  ): void {
    const logMethod =
      typeof this.adapter.log[level] === "function" ? level : "debug";

    if (!axios.isAxiosError(error)) {
      this.adapter.log[logMethod](`${label} failed: ${String(error)}`);
      return;
    }

    const statusCode = error.response?.status;
    const responseText = stringifyResponseData(error.response?.data);
    const errorCode = error.code ? ` (${error.code})` : "";

    this.adapter.log[logMethod](
      `${label} failed${errorCode}: ${error.message}${
        statusCode ? ` | status=${statusCode}` : ""
      }${responseText ? ` | response=${responseText}` : ""}`,
    );
  }
}
