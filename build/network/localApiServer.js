'use strict';
var __importDefault =
    (this && this.__importDefault) ||
    function (mod) {
        return mod && mod.__esModule ? mod : { default: mod };
    };
Object.defineProperty(exports, '__esModule', { value: true });
const node_http_1 = __importDefault(require('node:http'));
const constants_1 = require('../constants');
const helpers_1 = require('../utils/helpers');
const ABORTED_PEER_WARNING_THROTTLE_MS = 15 * 60_000;
function sendJson(response, statusCode, payload) {
    response.writeHead(statusCode, {
        'Content-Type': 'application/json',
    });
    response.end(JSON.stringify(payload));
}
function setCorsHeaders(response) {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Content-Length, X-Requested-With');
}
function createHttpError(message, statusCode) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}
function getErrorStatusCode(error) {
    if (error && typeof error === 'object' && 'statusCode' in error && typeof error.statusCode === 'number') {
        return error.statusCode;
    }
    return null;
}
function readRequestBody(request, maxBytes) {
    return new Promise((resolve, reject) => {
        let finished = false;
        let size = 0;
        let body = '';
        const rejectOnce = error => {
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
        request.on('data', chunk => {
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
class LocalApiServer {
    adapter;
    config;
    stateManager;
    deviceRegistry;
    requestClient;
    onDeviceSeen;
    server = null;
    openSockets = new Set();
    lastCloudMirrorErrorLogTs = 0;
    lastAbortedPeerWarningLogTs = 0;
    suppressedAbortedPeerWarnings = 0;
    constructor(adapter, config, stateManager, deviceRegistry, requestClient, onDeviceSeen) {
        this.adapter = adapter;
        this.config = config;
        this.stateManager = stateManager;
        this.deviceRegistry = deviceRegistry;
        this.requestClient = requestClient;
        this.onDeviceSeen = onDeviceSeen;
    }
    async start() {
        if (this.server) {
            return;
        }
        this.server = node_http_1.default.createServer((request, response) => {
            void this.handleRequest(request, response);
        });
        this.server.requestTimeout = constants_1.REQUEST_TIMEOUT_MS;
        this.server.headersTimeout = constants_1.REQUEST_TIMEOUT_MS + 1_000;
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
        await new Promise((resolve, reject) => {
            const server = this.server;
            if (!server) {
                resolve();
                return;
            }
            let handleListening = null;
            const handleError = error => {
                if (handleListening) {
                    server.off('listening', handleListening);
                }
                reject(error);
            };
            handleListening = () => {
                server.off('error', handleError);
                resolve();
            };
            server.once('listening', handleListening);
            server.once('error', handleError);
            server.listen(this.config.localPort);
        });
        this.adapter.log.debug(`Local API listening on port ${this.config.localPort}.`);
    }
    async dispose() {
        if (!this.server) {
            return;
        }
        const server = this.server;
        this.server = null;
        await new Promise(resolve => {
            const forceCloseTimeout = setTimeout(() => {
                for (const socket of this.openSockets) {
                    socket.destroy();
                }
            }, constants_1.LOCAL_API_SHUTDOWN_TIMEOUT_MS);
            server.close(() => {
                clearTimeout(forceCloseTimeout);
                resolve();
            });
        });
        for (const socket of this.openSockets) {
            socket.destroy();
        }
        this.openSockets.clear();
    }
    async handleRequest(request, response) {
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
            const rawBody = await readRequestBody(request, constants_1.LOCAL_API_BODY_LIMIT_BYTES);
            let payload;
            try {
                payload = JSON.parse(rawBody);
            } catch {
                throw createHttpError('Invalid JSON payload.', 400);
            }
            if (!(0, helpers_1.isRecord)(payload)) {
                throw createHttpError('Payload must be a JSON object.', 400);
            }
            if (this.config.localCloudMirrorEnabled) {
                void this.forwardPayloadToCloud(rawBody, request.headers['content-type']);
            }
            const mutablePayload = payload;
            const remoteIp = (0, helpers_1.normalizeIpAddress)(request.socket.remoteAddress);
            if (!mutablePayload.ip_addr && remoteIp) {
                mutablePayload.ip_addr = remoteIp;
            }
            const rawDeviceId = typeof mutablePayload.deviceId === 'string' ? mutablePayload.deviceId.trim() : '';
            if (!rawDeviceId) {
                throw createHttpError('Invalid or missing deviceId.', 400);
            }
            const deviceId = (0, helpers_1.normalizeDeviceId)(rawDeviceId);
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
    async forwardPayloadToCloud(rawBody, contentType) {
        try {
            await this.requestClient.post(constants_1.LOCAL_API_CLOUD_MIRROR_URL, rawBody, {
                headers: {
                    'Content-Type': typeof contentType === 'string' ? contentType : 'application/json',
                },
                timeoutMs: constants_1.REQUEST_TIMEOUT_MS,
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
                `Local API cloud mirror failed: ${error instanceof Error ? error.message : String(error)}. Repeated errors are suppressed for 7 minutes.`,
            );
        }
    }
}
exports.default = LocalApiServer;
//# sourceMappingURL=localApiServer.js.map
