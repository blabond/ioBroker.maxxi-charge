import { scheduleJob, type Job } from 'node-schedule';
import type { AdapterInstance } from '../types/shared';

export default class Scheduler {
    private readonly intervalHandles = new Set<Exclude<ioBroker.Interval, null>>();

    private readonly timeoutHandles = new Set<Exclude<ioBroker.Timeout, null>>();

    private readonly jobs = new Set<Job>();

    private disposed = false;

    public constructor(private readonly adapter: AdapterInstance) {}

    public setInterval(
        callback: () => Promise<void> | void,
        intervalMs: number,
        label = 'interval',
    ): ioBroker.Interval {
        if (this.disposed) {
            return null;
        }

        const handle =
            this.adapter.setInterval(() => {
                void this.executeSafely(callback, label);
            }, intervalMs) ?? null;

        if (handle !== null) {
            this.intervalHandles.add(handle);
        }
        return handle;
    }

    public clearInterval(handle: ioBroker.Interval): void {
        if (!handle) {
            return;
        }

        this.adapter.clearInterval(handle);
        this.intervalHandles.delete(handle);
    }

    public setTimeout(callback: () => Promise<void> | void, timeoutMs: number, label = 'timeout'): ioBroker.Timeout {
        if (this.disposed) {
            return null;
        }

        const handle =
            this.adapter.setTimeout(() => {
                if (handle !== null) {
                    this.timeoutHandles.delete(handle);
                }
                void this.executeSafely(callback, label);
            }, timeoutMs) ?? null;

        if (handle !== null) {
            this.timeoutHandles.add(handle);
        }
        return handle;
    }

    public clearTimeout(handle: ioBroker.Timeout): void {
        if (!handle) {
            return;
        }

        this.adapter.clearTimeout(handle);
        this.timeoutHandles.delete(handle);
    }

    public scheduleCron(name: string, rule: string, callback: () => Promise<void> | void): Job | null {
        if (this.disposed) {
            return null;
        }

        const job = scheduleJob(name, rule, () => {
            void this.executeSafely(callback, `cron:${name}`);
        });

        this.jobs.add(job);
        return job;
    }

    public cancelJob(job: Job | null): void {
        if (!job) {
            return;
        }

        job.cancel();
        this.jobs.delete(job);
    }

    public dispose(): Promise<void> {
        this.disposed = true;

        for (const handle of [...this.intervalHandles]) {
            this.clearInterval(handle);
        }

        for (const handle of [...this.timeoutHandles]) {
            this.clearTimeout(handle);
        }

        for (const job of [...this.jobs]) {
            this.cancelJob(job);
        }

        return Promise.resolve();
    }

    private async executeSafely(callback: () => Promise<void> | void, label: string): Promise<void> {
        try {
            await callback();
        } catch (error) {
            this.adapter.log.error(
                `Scheduler task ${label} failed: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }
}
