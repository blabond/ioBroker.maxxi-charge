'use strict';
const http = require('http');

module.exports = {
    setupLocalAPI(adapter) {
        const localApiPort = adapter.config.localApiPort || 5501;

        adapter.server = http.createServer((req, res) => {
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
                        const deviceId = data.deviceId || 'UnknownDevice';
                        const deviceFolder = `local-${deviceId}`;

                        const basePath = `${deviceFolder}.systeminfo`;
                        await adapter.processNestedData(basePath, data);

                        const ipAddress = adapter.extractClientIp(req);
                        await adapter.ensureStateExists(`${deviceFolder}.systeminfo.ip_addr`, ipAddress, "string", "IP-Adresse der Quelle");
                        await adapter.setStateAck(`${deviceFolder}.systeminfo.ip_addr`, ipAddress);

                        adapter.updateActiveCCU(deviceFolder);

                        if (!adapter.commandInitialized && data.deviceId) {
                            await adapter.initializeCommandSettings(deviceFolder, ipAddress);
                            adapter.commandInitialized = true;
                        }

                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ status: 'ok' }));
                    } catch (err) {
                        adapter.log.error('MaxxiCharge Local API: Fehler beim Parsen des JSON: ' + err);
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'invalid JSON' }));
                    }
                });
            } else {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('Not found');
            }
        });

        adapter.server.listen(localApiPort, () => {
            adapter.log.info(`MaxxiCharge Local API empfang gestartet auf Port ${localApiPort}`);
        });
    }
};
