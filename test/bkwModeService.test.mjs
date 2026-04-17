import bkwModeServiceModule from '../build/modes/bkwModeService.js';

const { default: BkwModeService } = bkwModeServiceModule;

describe('BkwModeService', () => {
    function createService({
        bkwEnabled = true,
        bkwAdjustment = -35,
        restorePendingState = false,
        primaryDeviceId = 'ccu1',
        activeDeviceIds = primaryDeviceId ? [primaryDeviceId] : [],
        restorePendingDeviceIds = primaryDeviceId && restorePendingState ? [primaryDeviceId] : [],
        socStates = {},
        applyDeviceSetting = async () => true,
    } = {}) {
        const states = new Map();
        for (const deviceId of restorePendingDeviceIds) {
            states.set(`${deviceId}._bkwModeRestorePending`, true);
        }
        for (const [deviceId, socValue] of Object.entries(socStates)) {
            states.set(`${deviceId}.SOC`, socValue);
        }

        const adapter = {
            namespace: 'maxxi-charge.0',
            log: {
                debug: () => {},
                warn: () => {},
                error: () => {},
            },
            getStateAsync: async id => (states.has(id) ? { val: states.get(id), ack: true } : null),
            setStateAsync: async (id, state) => {
                states.set(id, state.val);
            },
        };

        const stateManager = {
            setStateIfChanged: async (id, value) => {
                states.set(id, value);
                return true;
            },
            ensureStateObject: async () => {},
        };
        const commandService = {
            applyDeviceSetting,
        };
        const deviceRegistry = {
            getPrimaryDeviceId: () => primaryDeviceId,
            getActiveDeviceIds: () => activeDeviceIds,
        };
        const config = {
            bkwEnabled,
            bkwAdjustment,
            bkwPowerTarget: 800,
            feedInMode: 97,
            batteryCalibrationEnabled: false,
        };

        return {
            service: new BkwModeService(adapter, config, commandService, deviceRegistry, stateManager),
            adapter,
            stateManager,
            commandService,
            deviceRegistry,
            config,
        };
    }

    it('marks restore pending after the first successful BKW activation', async () => {
        const calls = [];
        const setStateCalls = [];
        const { service, stateManager, adapter } = createService({
            applyDeviceSetting: async (...args) => {
                calls.push(args);
                return true;
            },
        });

        stateManager.setStateIfChanged = async (...args) => {
            setStateCalls.push(args);
            await adapter.setStateAsync(args[0], { val: args[1], ack: args[2] });
            return true;
        };

        await service.handleSocChange('maxxi-charge.0.ccu1.SOC', {
            val: 99,
            ack: true,
        });
        await service.handleSocChange('maxxi-charge.0.ccu1.SOC', {
            val: 99,
            ack: true,
        });

        calls.should.have.length(2);
        calls.should.deep.equal([
            ['ccu1', 'maxSOC', 100, { source: 'bkwMode:activate' }],
            ['ccu1', 'baseLoad', -800, { source: 'bkwMode' }],
        ]);
        setStateCalls.should.deep.equal([['ccu1._bkwModeRestorePending', true, true]]);
    });

    it('restores the configured settings for an active device when restore is pending and BKW is disabled', async () => {
        const commandCalls = [];
        const setStateCalls = [];
        const { service, stateManager, config, adapter } = createService({
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
            await adapter.setStateAsync(args[0], { val: args[1], ack: args[2] });
            return true;
        };

        await service.start();

        commandCalls.should.deep.equal([
            ['ccu1', 'maxSOC', config.feedInMode, { source: 'bkwMode:restore:deviceAvailable' }],
            ['ccu1', 'baseLoad', config.bkwAdjustment, { source: 'bkwMode:restore:deviceAvailable' }],
        ]);
        setStateCalls.should.deep.equal([['ccu1._bkwModeRestorePending', false, true]]);
    });

    it('restores per device only when that device becomes available', async () => {
        const commandCalls = [];
        const setStateCalls = [];
        const { service, stateManager, adapter } = createService({
            bkwEnabled: false,
            restorePendingState: true,
            primaryDeviceId: null,
            activeDeviceIds: [],
            restorePendingDeviceIds: ['ccu1'],
            applyDeviceSetting: async (...args) => {
                commandCalls.push(args);
                return true;
            },
        });

        stateManager.setStateIfChanged = async (...args) => {
            setStateCalls.push(args);
            await adapter.setStateAsync(args[0], { val: args[1], ack: args[2] });
            return true;
        };

        await service.start();
        commandCalls.should.have.length(0);

        await service.handleDeviceAvailable('ccu1');
        await service.handleDeviceAvailable('ccu1');

        commandCalls.should.have.length(2);
        commandCalls.should.deep.equal([
            ['ccu1', 'maxSOC', 97, { source: 'bkwMode:restore:deviceAvailable' }],
            ['ccu1', 'baseLoad', -35, { source: 'bkwMode:restore:deviceAvailable' }],
        ]);
        setStateCalls.should.deep.equal([['ccu1._bkwModeRestorePending', false, true]]);
    });

    it('evaluates the current SOC on device availability when BKW mode is enabled', async () => {
        const commandCalls = [];
        const setStateCalls = [];
        const { service, stateManager, adapter } = createService({
            bkwEnabled: true,
            activeDeviceIds: ['ccu1'],
            socStates: {
                ccu1: 99,
            },
            applyDeviceSetting: async (...args) => {
                commandCalls.push(args);
                return true;
            },
        });

        stateManager.setStateIfChanged = async (...args) => {
            setStateCalls.push(args);
            await adapter.setStateAsync(args[0], { val: args[1], ack: args[2] });
            return true;
        };

        await service.start();

        commandCalls.should.deep.equal([
            ['ccu1', 'maxSOC', 100, { source: 'bkwMode:activate' }],
            ['ccu1', 'baseLoad', -800, { source: 'bkwMode' }],
        ]);
        setStateCalls.should.deep.equal([['ccu1._bkwModeRestorePending', true, true]]);
    });

    it('reinitializes a device after it was cleaned up as inactive', async () => {
        const commandCalls = [];
        const setStateCalls = [];
        const { service, stateManager, adapter } = createService({
            bkwEnabled: true,
            primaryDeviceId: null,
            activeDeviceIds: [],
            socStates: {
                ccu1: 99,
            },
            applyDeviceSetting: async (...args) => {
                commandCalls.push(args);
                return true;
            },
        });

        stateManager.setStateIfChanged = async (...args) => {
            setStateCalls.push(args);
            await adapter.setStateAsync(args[0], { val: args[1], ack: args[2] });
            return true;
        };

        await service.handleDeviceAvailable('ccu1');
        service.handleDeviceInactive('ccu1');
        await service.handleDeviceAvailable('ccu1');

        commandCalls.should.deep.equal([
            ['ccu1', 'maxSOC', 100, { source: 'bkwMode:activate' }],
            ['ccu1', 'baseLoad', -800, { source: 'bkwMode' }],
            ['ccu1', 'maxSOC', 100, { source: 'bkwMode:activate' }],
            ['ccu1', 'baseLoad', -800, { source: 'bkwMode' }],
        ]);
        setStateCalls.should.deep.equal([['ccu1._bkwModeRestorePending', true, true]]);
    });
});
