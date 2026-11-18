import { INGEST_SOURCE_TIMEOUT_MS } from "@keeper.sh/constants";
import type { IngestScheduleLane } from "@keeper.sh/database";
import { createHeartbeat } from "@keeper.sh/heartbeat";
import type { CronOptions } from "cronbake";
import { HEARTBEAT_FILE_PATH } from "./utils/heartbeat-file";
import { resolveJobAllowanceMs } from "./utils/job-allowance";
import { context, widelog } from "./utils/logging";

const LANE_STALE_AFTER_MS = 2 * INGEST_SOURCE_TIMEOUT_MS;

const UNKNOWN_UID = -1;

const reportHeartbeat = (name: string, error?: unknown): void => {
  context(() => {
    widelog.set("operation.name", name);
    widelog.set("operation.type", "lifecycle");
    widelog.set("heartbeat.path", HEARTBEAT_FILE_PATH);
    widelog.set("process.uid", process.getuid?.() ?? UNKNOWN_UID);
    if (error === globalThis.undefined) {
      widelog.set("outcome", "success");
    } else {
      widelog.set("outcome", "error");
      widelog.errorFields(error, { retriable: true, slug: "heartbeat-write-failed" });
    }
    widelog.flush();
  });
};

const heartbeat = createHeartbeat({
  filePath: HEARTBEAT_FILE_PATH,
  onWriteError: (error) => {
    reportHeartbeat("heartbeat-write", error);
  },
});

const startLiveness = (): void => {
  if (heartbeat.start()) {
    reportHeartbeat("heartbeat-start");
  }
};

const laneProgressed = (lane: IngestScheduleLane) => (): void => {
  heartbeat.beat(`ingest-${lane}`, LANE_STALE_AFTER_MS);
};

const withJobProgress = (job: CronOptions): CronOptions => {
  const allowanceMs = resolveJobAllowanceMs(job.cron);
  if (allowanceMs === null) {
    return job;
  }
  return {
    ...job,
    callback: async (): Promise<void> => {
      try {
        await job.callback();
      } finally {
        heartbeat.beat(`job-${job.name}`, allowanceMs);
      }
    },
  };
};

export { laneProgressed, startLiveness, withJobProgress };
