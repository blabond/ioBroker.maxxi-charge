describe("BatteryModeService", () => {
  const BatteryModeService =
    require("../build/modes/batteryModeService").default;

  function createService({
    activeDeviceIds = ["ccu1"],
    batteryCalibrationEnabled = true,
    calibrationProgress = "down",
    applyDeviceSetting = async () => true,
  } = {}) {
    const commandCalls = [];
    const nativeConfig = {
      batterycalibration: batteryCalibrationEnabled,
      calibrationProgress,
    };

    const adapter = {
      namespace: "maxxi-charge.0",
      log: {
        debug: () => {},
        error: () => {},
      },
      getForeignObjectAsync: async () => ({
        native: { ...nativeConfig },
      }),
      setForeignObjectAsync: async (_id, object) => {
        Object.assign(nativeConfig, object.native);
      },
    };

    const commandService = {
      applyDeviceSetting: async (...args) => {
        commandCalls.push(args);
        return applyDeviceSetting(...args);
      },
    };

    const deviceRegistry = {
      getPrimaryDeviceId: () => activeDeviceIds[0] ?? null,
      getActiveDeviceIds: () => activeDeviceIds,
    };

    const config = {
      batteryCalibrationEnabled,
      calibrationProgress,
    };

    return {
      service: new BatteryModeService(
        adapter,
        config,
        commandService,
        deviceRegistry,
      ),
      adapter,
      commandCalls,
      config,
      nativeConfig,
    };
  }

  it("applies battery calibration to all active devices on start", async () => {
    const { service, commandCalls } = createService({
      activeDeviceIds: ["ccu1", "ccu2"],
    });

    await service.start();

    commandCalls.should.deep.equal([
      ["ccu1", "minSOC", 0, { source: "batteryMode:down" }],
      ["ccu1", "maxSOC", 100, { source: "batteryMode:down" }],
      ["ccu2", "minSOC", 0, { source: "batteryMode:down" }],
      ["ccu2", "maxSOC", 100, { source: "batteryMode:down" }],
    ]);
  });

  it("switches from down to up phase immediately for all active devices", async () => {
    const { service, commandCalls, config, nativeConfig } = createService({
      activeDeviceIds: ["ccu1", "ccu2"],
    });

    await service.start();
    await service.handleSocChange("maxxi-charge.0.ccu1.SOC", {
      val: 9,
      ack: true,
    });

    commandCalls.should.deep.equal([
      ["ccu1", "minSOC", 0, { source: "batteryMode:down" }],
      ["ccu1", "maxSOC", 100, { source: "batteryMode:down" }],
      ["ccu2", "minSOC", 0, { source: "batteryMode:down" }],
      ["ccu2", "maxSOC", 100, { source: "batteryMode:down" }],
      ["ccu1", "minSOC", 99, { source: "batteryMode:up" }],
      ["ccu1", "maxSOC", 100, { source: "batteryMode:up" }],
      ["ccu2", "minSOC", 99, { source: "batteryMode:up" }],
      ["ccu2", "maxSOC", 100, { source: "batteryMode:up" }],
    ]);
    config.calibrationProgress.should.equal("up");
    nativeConfig.calibrationProgress.should.equal("up");
  });

  it("reapplies calibration for a device after per-device cleanup", async () => {
    const { service, commandCalls } = createService({
      activeDeviceIds: ["ccu1"],
    });

    await service.start();
    service.handleDeviceInactive("ccu1");
    await service.handleDeviceAvailable("ccu1");

    commandCalls.should.deep.equal([
      ["ccu1", "minSOC", 0, { source: "batteryMode:down" }],
      ["ccu1", "maxSOC", 100, { source: "batteryMode:down" }],
      ["ccu1", "minSOC", 0, { source: "batteryMode:down" }],
      ["ccu1", "maxSOC", 100, { source: "batteryMode:down" }],
    ]);
  });
});
