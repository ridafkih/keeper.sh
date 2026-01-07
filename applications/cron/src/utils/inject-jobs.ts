import type { CronOptions } from "cronbake";

const injectJobs = (configurations: CronOptions[]): CronOptions[] => configurations;

export { injectJobs };
