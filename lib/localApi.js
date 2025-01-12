'use strict';

const http = require('http');
const { name2id, processNestedData, validateInterval } = require('./utils');

class LocalApi {
    constructor(adapter) {
        this.adapter = adapter;
        this.server = null;
        this.stateCache = new Set(); // Cache für bestehende States
    }

    async init() {
        const localApiport = this.adapter.config.port || 5501;

        this.server = http.createServer((req, res) => {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Content-Length, X-Requested-With');

            if (req.method === 'OPTIONS') {
                res.writeHead(200);
                res.end();
                return;
            }

            if (req.method === 'POST') {
                let body = '';
                req.on('data', chunk => (body += chunk));
                req.on('end', async () => {
                    try {
                        const data = JSON.parse(body);
                        const rawDeviceId = data.deviceId || 'UnknownDevice'; // Original erhalten
						const deviceId = name2id(rawDeviceId).toLowerCase(); // Kleinbuchstaben erzwingen

                        if (!deviceId) {
                            this.adapter.log.warn('Invalid deviceId received.');
                            res.writeHead(400, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ error: 'Invalid deviceId' }));
                            return;
                        }

                        const deviceFolder = name2id(deviceId);

                        // Verarbeite die empfangenen Daten mit processNestedData
                        const basePath = `${deviceFolder}`;

                        await processNestedData(this.adapter, basePath, data, this.stateCache);


                        // Initialisiere `sendCommand`-Datenpunkte
                        await this.adapter.commands.initializeCommandSettings(deviceFolder);

                        // Setze die Verbindung als aktiv
                        await this.adapter.updateActiveCCU(deviceFolder);

                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ status: 'ok' }));
                    } catch (err) {
                        this.adapter.log.error(`MaxxiCharge Local API: Error parsing JSON: ${err.message}`);
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'invalid JSON' }));
                    }
                });
            } else {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('Not found');
            }
        });

        this.server.listen(localApiport, () => {
            this.adapter.log.debug(`MaxxiCharge Local API started listening on port ${localApiport}`);
        });
    }

    cleanup() {}
}

module.exports = LocalApi;
