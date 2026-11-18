import { MS_PER_HOUR, MS_PER_MINUTE, MS_PER_SECOND } from "@keeper.sh/constants";

const MINIMUM_ALLOWANCE_MS = 15 * MS_PER_MINUTE;
const MISSED_RUNS_ALLOWED = 3;

const UNIT_MS: Record<string, number> = {
  hours: MS_PER_HOUR,
  minutes: MS_PER_MINUTE,
  seconds: MS_PER_SECOND,
};

const EVERY_PRESET = /^@every_(\d+)_(seconds|minutes|hours)$/;

const resolveJobIntervalMs = (schedule: string): number | null => {
  const match = EVERY_PRESET.exec(schedule);
  if (!match) {
    return null;
  }
  const count = Number(match[1]);
  const unitMs = UNIT_MS[match[2] ?? ""];
  if (!unitMs || !Number.isInteger(count) || count < 1) {
    return null;
  }
  return count * unitMs;
};

const resolveJobAllowanceMs = (schedule: string): number | null => {
  const intervalMs = resolveJobIntervalMs(schedule);
  if (intervalMs === null) {
    return null;
  }
  return Math.max(MINIMUM_ALLOWANCE_MS, MISSED_RUNS_ALLOWED * intervalMs);
};

export { resolveJobAllowanceMs, resolveJobIntervalMs };
