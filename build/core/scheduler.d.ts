import { type Job } from 'node-schedule';
import type { AdapterInstance } from '../types/shared';
export default class Scheduler {
    private readonly adapter;
    private readonly intervalHandles;
    private readonly timeoutHandles;
    private readonly jobs;
    private disposed;
    constructor(adapter: AdapterInstance);
    createInterval(callback: () => Promise<void> | void, intervalMs: number, label?: string): ioBroker.Interval;
    deleteInterval(handle: ioBroker.Interval): void;
    createTimeout(callback: () => Promise<void> | void, timeoutMs: number, label?: string): ioBroker.Timeout;
    deleteTimeout(handle: ioBroker.Timeout): void;
    scheduleCron(name: string, rule: string, callback: () => Promise<void> | void): Job | null;
    cancelJob(job: Job | null): void;
    dispose(): Promise<void>;
    private executeSafely;
}
//# sourceMappingURL=scheduler.d.ts.map