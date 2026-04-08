import ecoModeServiceModule from "../build/modes/ecoModeService.js";

const { default: EcoModeService } = ecoModeServiceModule;

describe("EcoModeService", () => {
  function buildWinterWindow() {
    const winterFrom = new Date();
    winterFrom.setDate(winterFrom.getDate() - 1);

    const winterTo = new Date();
    winterTo.setDate(winterTo.getDate() + 2);

    return {
      winterFrom: {
        day: winterFrom.getDate(),
        month: winterFrom.getMonth() + 1,
      },
      winterTo: {
        day: winterTo.getDate(),
        month: winterTo.getMonth() + 1,
      },
    };
  }

  function createService({
    activeDeviceIds = ["ccu1", "ccu2"],
    applyDeviceSetting = async () => true,
  } = {}) {
    const commandCalls = [];
    const scheduledJobs = [];
    const { winterFrom, winterTo } = buildWinterWindow();

    const adapter = {
      namespace: "maxxi-charge.0",
      log: {
        debug: () => {},
        warn: () => {},
      },
    };

    const scheduler = {
      scheduleCron: (_name, _rule, callback) => {
        const job = {
          callback,
          cancel: () => true,
        };
        scheduledJobs.push(job);
        return job;
      },
      cancelJob: () => {},
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
      seasonModeEnabled: true,
      batteryCalibrationEnabled: false,
      winterFrom,
      winterTo,
      feedInMode: 95,
    };

    return {
      service: new EcoModeService(
        adapter,
        config,
        scheduler,
        commandService,
        deviceRegistry,
      ),
      commandCalls,
      scheduledJobs,
    };
  }

  it("evaluates all active devices on start", async () => {
    const { service, commandCalls, scheduledJobs } = createService();

    await service.start();

    scheduledJobs.should.have.length(1);
    commandCalls.should.deep.equal([
      ["ccu1", "minSOC", 60, { source: "ecoMode:winter" }],
      ["ccu1", "maxSOC", 95, { source: "ecoMode:winter" }],
      ["ccu2", "minSOC", 60, { source: "ecoMode:winter" }],
      ["ccu2", "maxSOC", 95, { source: "ecoMode:winter" }],
    ]);
  });

  it("tracks SOC-triggered relaxation independently per device", async () => {
    const { service, commandCalls } = createService();

    await service.start();
    await service.handleSocChange("maxxi-charge.0.ccu1.SOC", {
      val: 60,
      ack: true,
    });
    await service.handleSocChange("maxxi-charge.0.ccu1.SOC", {
      val: 60,
      ack: true,
    });
    await service.handleSocChange("maxxi-charge.0.ccu2.SOC", {
      val: 60,
      ack: true,
    });

    commandCalls.should.deep.equal([
      ["ccu1", "minSOC", 60, { source: "ecoMode:winter" }],
      ["ccu1", "maxSOC", 95, { source: "ecoMode:winter" }],
      ["ccu2", "minSOC", 60, { source: "ecoMode:winter" }],
      ["ccu2", "maxSOC", 95, { source: "ecoMode:winter" }],
      ["ccu1", "minSOC", 40, { source: "ecoMode:socTrigger" }],
      ["ccu2", "minSOC", 40, { source: "ecoMode:socTrigger" }],
    ]);
  });
});
