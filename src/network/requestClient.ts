import { REQUEST_TIMEOUT_MS } from "../constants";
import type { AdapterInstance, LogLevel } from "../types/shared";

type ResponseType = "auto" | "json" | "text" | "none";
type RequestHeaders =
  | Headers
  | Record<string, string>
  | Array<[string, string]>;
type RequestBody =
  | string
  | URLSearchParams
  | ArrayBuffer
  | ArrayBufferView
  | Blob
  | FormData
  | ReadableStream;

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

    if (typeof options.cause !== "undefined") {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

class HttpStatusError extends RequestClientError {
  public constructor(
    status: number,
    statusText: string,
    responseData: unknown,
  ) {
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
    super("Invalid JSON response received", {
      code: "ERR_INVALID_JSON",
      status,
      responseData: responseText,
      cause,
    });
  }
}

class TimeoutRequestError extends RequestClientError {
  public constructor(timeoutMs: number) {
    super(`timeout of ${timeoutMs}ms exceeded`, {
      code: "ETIMEDOUT",
    });
  }
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

function isBodyInit(value: unknown): value is RequestBody {
  if (
    typeof value === "string" ||
    value instanceof URLSearchParams ||
    value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value)
  ) {
    return true;
  }

  if (typeof Blob !== "undefined" && value instanceof Blob) {
    return true;
  }

  if (typeof FormData !== "undefined" && value instanceof FormData) {
    return true;
  }

  if (
    typeof ReadableStream !== "undefined" &&
    value instanceof ReadableStream
  ) {
    return true;
  }

  return false;
}

function buildRequestBody(
  data: unknown,
  headers: Headers,
): RequestBody | undefined {
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

function isJsonContentType(contentType: string | null): boolean {
  if (!contentType) {
    return false;
  }

  const normalizedContentType = contentType.toLowerCase();
  return (
    normalizedContentType.includes("application/json") ||
    normalizedContentType.includes("+json")
  );
}

async function parseResponseData(
  response: Response,
  responseType: ResponseType,
): Promise<unknown> {
  if (
    responseType === "none" ||
    response.status === 204 ||
    response.status === 205
  ) {
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
  } catch (error) {
    if (
      responseType === "json" ||
      isJsonContentType(response.headers.get("Content-Type"))
    ) {
      throw new InvalidJsonResponseError(response.status, rawText, error);
    }

    return rawText;
  }
}

export default class RequestClient {
  public constructor(
    private readonly adapter: AdapterInstance,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  public async get<T = unknown>(
    url: string,
    options: RequestOptions = {},
  ): Promise<RequestClientResponse<T>> {
    return this.request<T>(
      {
        method: "GET",
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
        method: "POST",
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
    const controller = new AbortController();
    const headers = new Headers(options.headers);
    const configHeaders = new Headers(config.headers);
    const requestData =
      typeof config.body !== "undefined" ? config.body : config.data;
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
      const requestInit: RequestInit = {
        method: config.method.toUpperCase(),
        headers,
        signal: controller.signal,
      };

      if (typeof requestBody !== "undefined") {
        requestInit.body = requestBody as NonNullable<RequestInit["body"]>;
      }

      const response = await this.fetchImpl(config.url, requestInit);

      const data = await parseResponseData(
        response,
        options.responseType ?? config.responseType ?? "auto",
      );

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
      const normalizedError = timedOut
        ? new TimeoutRequestError(timeoutMs)
        : error;

      this.logRequestError(
        options.label ?? config.url,
        normalizedError,
        options.logLevel,
      );
      throw normalizedError;
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  private logRequestError(
    label: string,
    error: unknown,
    level: LogLevel = "debug",
  ): void {
    const logMethod =
      typeof this.adapter.log[level] === "function" ? level : "debug";

    if (!(error instanceof RequestClientError)) {
      this.adapter.log[logMethod](`${label} failed: ${String(error)}`);
      return;
    }

    const statusCode = error.status;
    const responseText = stringifyResponseData(error.responseData);
    const errorCode = error.code ? ` (${error.code})` : "";

    this.adapter.log[logMethod](
      `${label} failed${errorCode}: ${error.message}${
        statusCode ? ` | status=${statusCode}` : ""
      }${responseText ? ` | response=${responseText}` : ""}`,
    );
  }
}
