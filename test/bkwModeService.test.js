describe("BkwModeService", () => {
  const BkwModeService = require("../build/modes/bkwModeService").default;

  function createService({
    bkwEnabled = true,
    bkwAdjustment = -35,
    restorePendingState = false,
    primaryDeviceId = "ccu1",
    applyDeviceSetting = async () => true,
  } = {}) {
    const adapter = {
      namespace: "maxxi-charge.0",
      log: {
        debug: () => {},
        warn: () => {},
        error: () => {},
      },
      getStateAsync: async (id) => {
        if (id === "info.bkwModeRestorePending") {
          return { val: restorePendingState, ack: true };
        }

        return null;
      },
    };

    const stateManager = {
      setStateIfChanged: async () => true,
    };
    const commandService = {
      applyDeviceSetting,
    };
    const deviceRegistry = {
      getPrimaryDeviceId: () => primaryDeviceId,
    };
    const config = {
      bkwEnabled,
      bkwAdjustment,
      bkwPowerTarget: 800,
      batteryCalibrationEnabled: false,
    };

    return {
      service: new BkwModeService(
        adapter,
        config,
        commandService,
        deviceRegistry,
        stateManager,
      ),
      adapter,
      stateManager,
      commandService,
      deviceRegistry,
      config,
    };
  }

  it("marks restore pending after the first successful BKW baseLoad update", async () => {
    const calls = [];
    const setStateCalls = [];
    const { service, stateManager } = createService({
      applyDeviceSetting: async (...args) => {
        calls.push(args);
        return true;
      },
    });

    stateManager.setStateIfChanged = async (...args) => {
      setStateCalls.push(args);
      return true;
    };

    await service.handleSocChange("maxxi-charge.0.ccu1.SOC", {
      val: 99,
      ack: true,
    });
    await service.handleSocChange("maxxi-charge.0.ccu1.SOC", {
      val: 99,
      ack: true,
    });

    calls.should.have.length(1);
    setStateCalls.should.deep.equal([
      ["info.bkwModeRestorePending", true, true],
    ]);
  });

  it("restores the configured baseLoad once on startup when restore is pending and BKW is disabled", async () => {
    const commandCalls = [];
    const setStateCalls = [];
    const { service, stateManager, config } = createService({
      bkwEnabled: false,
      bkwAdjustment: -42,
      restorePendingState: true,
      applyDeviceSetting: async (...args) => {
        commandCalls.push(args);
        return true;
      },
    });

    stateManager.setStateIfChanged = async (...args) => {
      setStateCalls.push(args);
      return true;
    };

    await service.start();

    commandCalls.should.deep.equal([
      [
        "ccu1",
        "baseLoad",
        config.bkwAdjustment,
        { source: "bkwMode:restore:startup" },
      ],
    ]);
    setStateCalls.should.deep.equal([
      ["info.bkwModeRestorePending", false, true],
    ]);
  });

  it("defers startup restore until a device becomes available", async () => {
    const commandCalls = [];
    const setStateCalls = [];
    const { service, stateManager } = createService({
      bkwEnabled: false,
      restorePendingState: true,
      primaryDeviceId: null,
      applyDeviceSetting: async (...args) => {
        commandCalls.push(args);
        return true;
      },
    });

    stateManager.setStateIfChanged = async (...args) => {
      setStateCalls.push(args);
      return true;
    };

    await service.start();
    commandCalls.should.have.length(0);

    await service.handleDeviceAvailable("ccu1");
    await service.handleDeviceAvailable("ccu1");

    commandCalls.should.have.length(1);
    setStateCalls.should.deep.equal([
      ["info.bkwModeRestorePending", false, true],
    ]);
  });
});
