import http, { type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import {
    LOCAL_API_BODY_LIMIT_BYTES,
    LOCAL_API_CLOUD_MIRROR_URL,
    LOCAL_API_SHUTDOWN_TIMEOUT_MS,
    REQUEST_TIMEOUT_MS,
} from '../constants';
import type { AdapterInstance, DeviceTouchEvent } from '../types/shared';
import { isRecord, normalizeDeviceId, normalizeIpAddress } from '../utils/helpers';
import type DeviceRegistry from '../core/deviceRegistry';
import type StateManager from '../core/stateManager';
import type RequestClient from './requestClient';

const ABORTED_PEER_WARNING_THROTTLE_MS = 15 * 60_000;

function sendJson(
    response: ServerResponse<IncomingMessage>,
    statusCode: number,
    payload: Record<string, unknown>,
): void {
    response.writeHead(statusCode, {
        'Content-Type': 'application/json',
    });
    response.end(JSON.stringify(payload));
}

function setCorsHeaders(response: ServerResponse<IncomingMessage>): void {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Content-Length, X-Requested-With');
}

function createHttpError(
    message: string,
    statusCode: number,
): Error & {
    statusCode: number;
} {
    const error = new Error(message) as Error & { statusCode: number };
    error.statusCode = statusCode;
    return error;
}

function getErrorStatusCode(error: unknown): number | null {
    if (error && typeof error === 'object' && 'statusCode' in error && typeof error.statusCode === 'number') {
        return error.statusCode;
    }

    return null;
}

function readRequestBody(request: IncomingMessage, maxBytes: number): Promise<string> {
    return new Promise((resolve, reject) => {
        let finished = false;
        let size = 0;
        let body = '';

        const rejectOnce = (error: Error): void => {
            if (finished) {
                return;
            }

            finished = true;
            reject(error);
        };

        request.setEncoding('utf8');

        request.on('aborted', () => {
            rejectOnce(createHttpError('Request aborted by peer.', 400));
        });

        request.on('error', error => {
            rejectOnce(createHttpError(`Request stream error: ${error.message}`, 400));
        });

        request.on('data', (chunk: string) => {
            if (finished) {
                return;
            }

            size += Buffer.byteLength(chunk);
            if (size > maxBytes) {
                request.destroy();
                rejectOnce(createHttpError('Request body too large.', 413));
                return;
            }

            body += chunk;
        });

        request.on('end', () => {
            if (finished) {
                return;
            }

            finished = true;
            resolve(body);
        });
    });
}

export default class LocalApiServer {
    private server: Server | null = null;

    private readonly openSockets = new Set<Socket>();

    private lastCloudMirrorErrorLogTs = 0;
    private lastAbortedPeerWarningLogTs = 0;
    private suppressedAbortedPeerWarnings = 0;

    public constructor(
        private readonly adapter: AdapterInstance,
        private readonly config: {
            localPort: number;
            localCloudMirrorEnabled: boolean;
        },
        private readonly stateManager: StateManager,
        private readonly deviceRegistry: DeviceRegistry,
        private readonly requestClient: RequestClient,
        private readonly onDeviceSeen: (deviceEvent: DeviceTouchEvent) => Promise<void>,
    ) {}

    public async start(): Promise<void> {
        if (this.server) {
            return;
        }

        this.server = http.createServer((request, response) => {
            void this.handleRequest(request, response);
        });

        this.server.requestTimeout = REQUEST_TIMEOUT_MS;
        this.server.headersTimeout = REQUEST_TIMEOUT_MS + 1_000;
        this.server.keepAliveTimeout = 1_000;

        this.server.on('connection', socket => {
            this.openSockets.add(socket);
            socket.on('close', () => {
                this.openSockets.delete(socket);
            });
        });

        this.server.on('error', error => {
            this.adapter.log.error(`Local API server error: ${error.message}`);
        });

        await new Promise<void>((resolve, reject) => {
            const server = this.server;
            if (!server) {
                resolve();
                return;
            }

            let handleListening: (() => void) | null = null;

            const handleError = (error: Error): void => {
                if (handleListening) {
                    server.off('listening', handleListening);
                }
                reject(error);
            };

            handleListening = (): void => {
                server.off('error', handleError);
                resolve();
            };

            server.once('listening', handleListening);
            server.once('error', handleError);
            server.listen(this.config.localPort);
        });

        this.adapter.log.debug(`Local API listening on port ${this.config.localPort}.`);
    }

    public async dispose(): Promise<void> {
        if (!this.server) {
            return;
        }

        const server = this.server;
        this.server = null;

        await new Promise<void>(resolve => {
            const forceCloseTimeout = this.adapter.setTimeout(() => {
                for (const socket of this.openSockets) {
                    socket.destroy();
                }
            }, LOCAL_API_SHUTDOWN_TIMEOUT_MS);

            server.close(() => {
                this.adapter.clearTimeout(forceCloseTimeout);
                resolve();
            });
        });

        for (const socket of this.openSockets) {
            socket.destroy();
        }

        this.openSockets.clear();
    }

    private async handleRequest(request: IncomingMessage, response: ServerResponse<IncomingMessage>): Promise<void> {
        setCorsHeaders(response);

        if (request.method === 'OPTIONS') {
            response.writeHead(204);
            response.end();
            return;
        }

        if (request.method !== 'POST') {
            sendJson(response, 404, { error: 'Not found' });
            return;
        }

        try {
            const rawBody = await readRequestBody(request, LOCAL_API_BODY_LIMIT_BYTES);
            let payload: unknown;

            try {
                payload = JSON.parse(rawBody);
            } catch {
                throw createHttpError('Invalid JSON payload.', 400);
            }

            if (!isRecord(payload)) {
                throw createHttpError('Payload must be a JSON object.', 400);
            }

            if (this.config.localCloudMirrorEnabled) {
                void this.forwardPayloadToCloud(rawBody, request.headers['content-type']);
            }

            const mutablePayload: Record<string, unknown> = payload;
            const remoteIp = normalizeIpAddress(request.socket.remoteAddress);
            if (!mutablePayload.ip_addr && remoteIp) {
                mutablePayload.ip_addr = remoteIp;
            }

            const rawDeviceId = typeof mutablePayload.deviceId === 'string' ? mutablePayload.deviceId.trim() : '';
            if (!rawDeviceId) {
                throw createHttpError('Invalid or missing deviceId.', 400);
            }

            const deviceId = normalizeDeviceId(rawDeviceId);
            if (!deviceId) {
                throw createHttpError('Invalid or missing deviceId.', 400);
            }

            await this.stateManager.syncDevicePayload(deviceId, mutablePayload);

            const deviceTouchResult = await this.deviceRegistry.touch(deviceId);
            await this.onDeviceSeen(deviceTouchResult);

            sendJson(response, 200, { status: 'ok' });
        } catch (error) {
            const statusCode = getErrorStatusCode(error) ?? 500;
            const message = error instanceof Error ? error.message : String(error);
            const now = Date.now();

            if (statusCode >= 500) {
                this.adapter.log.error(`Local API request failed: ${message}`);
            } else {
                if (message === 'Request aborted by peer.') {
                    if (now - this.lastAbortedPeerWarningLogTs < ABORTED_PEER_WARNING_THROTTLE_MS) {
                        this.suppressedAbortedPeerWarnings += 1;
                    } else {
                        const suppressedCount = this.suppressedAbortedPeerWarnings;
                        this.suppressedAbortedPeerWarnings = 0;
                        this.lastAbortedPeerWarningLogTs = now;

                        const suppressedSuffix =
                            suppressedCount > 0
                                ? ` Suppressed ${suppressedCount} similar warnings in the last 15 minutes.`
                                : '';

                        this.adapter.log.warn(`Local API request failed: ${message}${suppressedSuffix}`);
                    }
                } else {
                    this.adapter.log.warn(`Local API request failed: ${message}`);
                }
            }

            if (!response.writableEnded) {
                sendJson(response, statusCode, { error: message });
            }
        }
    }

    private async forwardPayloadToCloud(rawBody: string, contentType: string | string[] | undefined): Promise<void> {
        try {
            await this.requestClient.post(LOCAL_API_CLOUD_MIRROR_URL, rawBody, {
                headers: {
                    'Content-Type': typeof contentType === 'string' ? contentType : 'application/json',
                },
                timeoutMs: REQUEST_TIMEOUT_MS,
                label: 'Local API cloud mirror',
                logLevel: 'debug',
            });
        } catch (error) {
            const now = Date.now();
            if (now - this.lastCloudMirrorErrorLogTs < 7 * 60_000) {
                return;
            }

            this.lastCloudMirrorErrorLogTs = now;
            this.adapter.log.warn(
                `Local API cloud mirror failed: ${
                    error instanceof Error ? error.message : String(error)
                }. Repeated errors are suppressed for 7 minutes.`,
            );
        }
    }
}
