import { type Job } from 'node-schedule';
import type { AdapterInstance } from '../types/shared';
export default class Scheduler {
    private readonly adapter;
    private readonly intervalHandles;
    private readonly timeoutHandles;
    private readonly jobs;
    private disposed;
    constructor(adapter: AdapterInstance);
    setInterval(callback: () => Promise<void> | void, intervalMs: number, label?: string): ioBroker.Interval;
    clearInterval(handle: ioBroker.Interval): void;
    setTimeout(callback: () => Promise<void> | void, timeoutMs: number, label?: string): ioBroker.Timeout;
    clearTimeout(handle: ioBroker.Timeout): void;
    scheduleCron(name: string, rule: string, callback: () => Promise<void> | void): Job | null;
    cancelJob(job: Job | null): void;
    dispose(): Promise<void>;
    private executeSafely;
}
//# sourceMappingURL=scheduler.d.ts.map
