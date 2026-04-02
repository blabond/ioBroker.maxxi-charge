declare module "node-schedule" {
  export interface Job {
    cancel(reschedule?: boolean): boolean;
  }

  export function scheduleJob(
    name: string,
    rule: string,
    callback: () => void,
  ): Job;
}
