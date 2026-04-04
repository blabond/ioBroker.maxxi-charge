"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_schedule_1 = require("node-schedule");
class Scheduler {
  adapter;
  intervalHandles = new Set();
  timeoutHandles = new Set();
  jobs = new Set();
  disposed = false;
  constructor(adapter) {
    this.adapter = adapter;
  }
  setInterval(callback, intervalMs, label = "interval") {
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
  clearInterval(handle) {
    if (!handle) {
      return;
    }
    this.adapter.clearInterval(handle);
    this.intervalHandles.delete(handle);
  }
  setTimeout(callback, timeoutMs, label = "timeout") {
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
  clearTimeout(handle) {
    if (!handle) {
      return;
    }
    this.adapter.clearTimeout(handle);
    this.timeoutHandles.delete(handle);
  }
  scheduleCron(name, rule, callback) {
    if (this.disposed) {
      return null;
    }
    const job = (0, node_schedule_1.scheduleJob)(name, rule, () => {
      void this.executeSafely(callback, `cron:${name}`);
    });
    this.jobs.add(job);
    return job;
  }
  cancelJob(job) {
    if (!job) {
      return;
    }
    job.cancel();
    this.jobs.delete(job);
  }
  dispose() {
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
  async executeSafely(callback, label) {
    try {
      await callback();
    } catch (error) {
      this.adapter.log.error(
        `Scheduler task ${label} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
exports.default = Scheduler;
//# sourceMappingURL=scheduler.js.map
