describe("CloudApiPoller", () => {
  const CloudApiPoller = require("../build/network/cloudApiPoller").default;
  const {
    CLOUD_CCU_INTERVAL_MS,
    CLOUD_CCU_REQUEST_TIMEOUT_MS,
  } = require("../build/constants");

  function createPoller({ requestClient } = {}) {
    const adapter = {
      log: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      },
    };

    const scheduler = {
      setTimeout: () => null,
      setInterval: () => null,
      clearTimeout: () => {},
      clearInterval: () => {},
    };

    const stateManager = {
      syncSettingsPayload: async () => {},
      syncDevicePayload: async () => {},
    };

    const deviceRegistry = {
      touch: async () => ({
        deviceId: "ccu1",
        isNewDevice: false,
        connectionBecameActive: false,
      }),
    };

    const poller = new CloudApiPoller(
      adapter,
      { ccuName: "maxxi-123456-abc", ccuIntervalMs: CLOUD_CCU_INTERVAL_MS },
      scheduler,
      stateManager,
      deviceRegistry,
      requestClient ?? { get: async () => ({ data: {} }) },
      async () => {},
    );

    poller.started = true;
    return poller;
  }

  it("uses a dedicated timeout and no retries for CCU polling", async () => {
    const requestCalls = [];
    const poller = createPoller({
      requestClient: {
        get: async (...args) => {
          requestCalls.push(args);
          throw new Error("timeout");
        },
      },
    });

    await poller.pollCcu();

    requestCalls.should.have.length(1);
    requestCalls[0][1].timeoutMs.should.equal(CLOUD_CCU_REQUEST_TIMEOUT_MS);
  });
});
