import { readFileSync } from "node:fs";
import { parseHeartbeatSnapshot } from "./snapshot";

interface StalePulse {
  ageMs: number;
  name: string;
  staleAfterMs: number;
}

type HeartbeatStatus =
  | { healthy: true; reason: "absent" | "fresh" | "unreadable" }
  | { healthy: false; stale: StalePulse[] };

interface HeartbeatCheckOptions {
  filePath: string;
  now?: () => number;
  read?: (filePath: string) => string | null;
}

const isMissingFileError = (error: unknown): boolean =>
  error instanceof Error && "code" in error && error.code === "ENOENT";

const readFileOrNull = (filePath: string): string | null => {
  try {
    return readFileSync(filePath, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }
    throw error;
  }
};

const checkHeartbeat = (options: HeartbeatCheckOptions): HeartbeatStatus => {
  const read = options.read ?? readFileOrNull;
  const contents = read(options.filePath);
  if (contents === null) {
    return { healthy: true, reason: "absent" };
  }

  const snapshot = parseHeartbeatSnapshot(contents);
  if (!snapshot) {
    return { healthy: true, reason: "unreadable" };
  }

  const at = (options.now ?? Date.now)();
  const stale = Object.entries(snapshot.pulses)
    .map(([name, pulse]) => ({ ageMs: at - pulse.beatAt, name, staleAfterMs: pulse.staleAfterMs }))
    .filter(({ ageMs, staleAfterMs }) => ageMs > staleAfterMs);

  if (stale.length > 0) {
    return { healthy: false, stale };
  }
  return { healthy: true, reason: "fresh" };
};

const describeHeartbeatStatus = (status: HeartbeatStatus): string => {
  if (status.healthy) {
    return `heartbeat ${status.reason}`;
  }
  const details = status.stale
    .map(({ ageMs, name, staleAfterMs }) => `${name} last progressed ${ageMs}ms ago (allowed ${staleAfterMs}ms)`)
    .join("; ");
  return `heartbeat stale: ${details}`;
};

const EXIT_HEALTHY = 0;
const EXIT_UNHEALTHY = 1;

const runHeartbeatCheck = (
  options: HeartbeatCheckOptions,
  report: (line: string) => void,
): number => {
  try {
    const status = checkHeartbeat(options);
    report(describeHeartbeatStatus(status));
    if (status.healthy) {
      return EXIT_HEALTHY;
    }
    return EXIT_UNHEALTHY;
  } catch (error) {
    report(`heartbeat check could not run: ${String(error)}`);
    return EXIT_HEALTHY;
  }
};

export { checkHeartbeat, describeHeartbeatStatus, runHeartbeatCheck };
export type { HeartbeatCheckOptions, HeartbeatStatus, StalePulse };
