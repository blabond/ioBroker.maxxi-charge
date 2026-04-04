describe("CommandService", () => {
  const CommandService = require("../build/commands/commandService").default;

  function createEnvironment({
    schemaVersionState,
    withSendcommandChannel = true,
  } = {}) {
    const states = new Map();
    const objects = new Set(["ccu1"]);
    const deletedObjects = [];
    const subscribeCalls = [];
    const unsubscribeCalls = [];

    if (withSendcommandChannel) {
      objects.add("ccu1.sendcommand");
    }

    if (typeof schemaVersionState !== "undefined") {
      states.set("ccu1._sendcommandSchemaVersion", schemaVersionState);
    }

    const adapter = {
      namespace: "maxxi-charge.0",
      log: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      },
      getObjectAsync: async (id) =>
        objects.has(id)
          ? { _id: id, type: id.endsWith("sendcommand") ? "channel" : "state" }
          : null,
      getStateAsync: async (id) =>
        states.has(id) ? { val: states.get(id), ack: true } : null,
      setStateAsync: async (id, state) => {
        states.set(id, state.val);
      },
      delObjectAsync: async (id, options) => {
        deletedObjects.push([id, options]);
        for (const objectId of [...objects]) {
          if (objectId === id || objectId.startsWith(`${id}.`)) {
            objects.delete(objectId);
          }
        }
      },
      subscribeStates: (id) => {
        subscribeCalls.push(id);
      },
      unsubscribeStates: (id) => {
        unsubscribeCalls.push(id);
      },
    };

    const stateManager = {
      ensureDevice: async (id) => {
        objects.add(id);
      },
      ensureChannel: async (id) => {
        objects.add(id);
      },
      ensureStateObject: async (id) => {
        objects.add(id);
      },
      clearCaches: () => {},
      setStateIfChanged: async () => true,
    };

    const requestClient = {
      post: async () => {},
    };

    return {
      createService: () =>
        new CommandService(adapter, stateManager, requestClient),
      deletedObjects,
      states,
      subscribeCalls,
      unsubscribeCalls,
    };
  }

  it("resets sendcommand on update and skips the reset on the next reload", async () => {
    const environment = createEnvironment({
      withSendcommandChannel: true,
    });

    const firstService = environment.createService();
    await firstService.ensureDeviceStates("ccu1");

    environment.deletedObjects.should.deep.equal([
      ["ccu1.sendcommand", { recursive: true }],
    ]);
    environment.states.get("ccu1._sendcommandSchemaVersion").should.equal(4);
    environment.subscribeCalls.should.have.length(8);

    const secondService = environment.createService();
    await secondService.ensureDeviceStates("ccu1");

    environment.deletedObjects.should.have.length(1);
    environment.unsubscribeCalls.should.have.length(0);
    environment.states.get("ccu1._sendcommandSchemaVersion").should.equal(4);
  });

  it("resets sendcommand again when the internal schema version is older than 4", async () => {
    const environment = createEnvironment({
      schemaVersionState: 3,
      withSendcommandChannel: true,
    });

    const service = environment.createService();
    await service.ensureDeviceStates("ccu1");

    environment.deletedObjects.should.deep.equal([
      ["ccu1.sendcommand", { recursive: true }],
    ]);
    environment.states.get("ccu1._sendcommandSchemaVersion").should.equal(4);
  });

  it("sets the internal schema version to 4 without deleting anything on a fresh install", async () => {
    const environment = createEnvironment({
      withSendcommandChannel: false,
    });

    const service = environment.createService();
    await service.ensureDeviceStates("ccu1");

    environment.deletedObjects.should.deep.equal([]);
    environment.states.get("ccu1._sendcommandSchemaVersion").should.equal(4);
  });
});
