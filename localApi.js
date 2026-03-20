"use strict";

const http = require("http");
const axios = require("axios");
const { name2id, processNestedData } = require("./utils");

const LOCAL_API_CLOUD_MIRROR_URL = "http://maxxisun.app:3001/text";

function isEnabled(value) {
  return value === true || value === "true" || value === 1 || value === "1";
}

class LocalApi {
  constructor(adapter) {
    this.adapter = adapter;
    this.server = null;
    this.stateCache = new Set();

    // Spam-Schutz
    this.lastCloudMirrorErrorLogTs = 0;
    this.cloudMirrorErrorLogIntervalMs = 7 * 60 * 1000; // 7 Minuten
  }

  shouldLogCloudMirrorError() {
    const now = Date.now();

    if (
      !this.lastCloudMirrorErrorLogTs ||
      now - this.lastCloudMirrorErrorLogTs >= this.cloudMirrorErrorLogIntervalMs
    ) {
      this.lastCloudMirrorErrorLogTs = now;
      return true;
    }

    return false;
  }

  async init() {
    const localApiport = this.adapter.config.port || 5501;
    const cloudMirrorEnabled = isEnabled(this.adapter.config.localCloudMirror);

    this.adapter.log.debug(
      `MaxxiCharge Local API: Cloud mirror ${cloudMirrorEnabled ? "enabled" : "disabled"} (config value: ${JSON.stringify(this.adapter.config.localCloudMirror)})`,
    );

    this.server = http.createServer((req, res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, Content-Length, X-Requested-With",
      );

      if (req.method === "OPTIONS") {
        res.writeHead(200);
        res.end();
        return;
      }

      if (req.method === "POST") {
        let body = "";

        req.on("data", (chunk) => {
          body += chunk;
        });

        req.on("end", async () => {
          try {
            // Mirror direkt ausführen (fire & forget bleibt)
            if (cloudMirrorEnabled) {
              void this.forwardPayloadToCloud(
                body,
                req.headers["content-type"],
              );
            }

            const data = JSON.parse(body);
            const remoteIp = req.socket.remoteAddress?.replace(/^::ffff:/, "");

            if (!data.ip_addr && remoteIp) {
              data.ip_addr = remoteIp;
            }

            const rawDeviceId = data.deviceId || "UnknownDevice";
            const deviceId = name2id(rawDeviceId).toLowerCase();

            if (!deviceId) {
              this.adapter.log.warn("Invalid deviceId received.");
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "Invalid deviceId" }));
              return;
            }

            const deviceFolder = name2id(deviceId);
            const basePath = `${deviceFolder}`;

            await processNestedData(
              this.adapter,
              basePath,
              data,
              this.stateCache,
            );

            await this.adapter.commands.initializeCommandSettings(deviceFolder);
            await this.adapter.updateActiveCCU(deviceFolder);

            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ status: "ok" }));
          } catch (err) {
            this.adapter.log.error(
              `MaxxiCharge Local API: Error parsing JSON: ${err.message}`,
            );
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "invalid JSON" }));
          }
        });

        req.on("error", (err) => {
          this.adapter.log.error(
            `MaxxiCharge Local API: Request stream error: ${err.message}`,
          );
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "request stream error" }));
        });
      } else {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
      }
    });

    this.server.listen(localApiport, () => {
      this.adapter.log.debug(
        `MaxxiCharge Local API started listening on port ${localApiport}`,
      );
    });
  }

  cleanup() {
    if (this.server) {
      this.server.close(() => {});
      this.server = null;
    }

    if (this.stateCache) {
      this.stateCache.clear();
    }
  }

  async forwardPayloadToCloud(rawBody, contentType) {
    try {
      await axios.post(LOCAL_API_CLOUD_MIRROR_URL, rawBody, {
        headers: {
          "Content-Type": contentType || "application/json",
        },
        timeout: 7500,
      });
    } catch (error) {
      const statusCode = error.response?.status;
      const responseBody =
        typeof error.response?.data === "string"
          ? error.response.data
          : JSON.stringify(error.response?.data);
      const errorCode = error.code ? ` (${error.code})` : "";

      if (this.shouldLogCloudMirrorError()) {
        this.adapter.log.warn(
          `MaxxiCharge Local API: Cloud mirror failed${errorCode}: ${error.message}${
            statusCode ? ` | status=${statusCode}` : ""
          }${
            responseBody ? ` | response=${responseBody}` : ""
          } | weitere gleiche Fehler werden für 7 Minuten unterdrückt`,
        );
      }
    }
  }
}

module.exports = LocalApi;
