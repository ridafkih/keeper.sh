import { createHeartbeat } from "@keeper.sh/heartbeat";
import { USER_TIMEOUT_MS } from "@keeper.sh/queue";
import { HEARTBEAT_FILE_PATH } from "./utils/heartbeat-file";
import { context, widelog } from "./utils/logging";
import { createJobFlow, probeQueue } from "./queue-progress";
import type { JobFlow } from "./queue-progress";

const QUEUE_STALE_AFTER_MS = 900_000;
const JOB_STALL_AFTER_MS = 2 * USER_TIMEOUT_MS;
const PROBE_INTERVAL_MS = 30_000;
const PING_TIMEOUT_MS = 10_000;

interface QueueProbe {
  isRunning: () => boolean;
  jobFlow: JobFlow;
  ping: () => Promise<unknown>;
}

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

const createQueueJobFlow = (): JobFlow => createJobFlow({ stallAfterMs: JOB_STALL_AFTER_MS });

const startQueueProbe = (probe: QueueProbe): (() => void) => {
  const timer = setInterval(() => {
    probeQueue({
      isRunning: probe.isRunning,
      isStalled: probe.jobFlow.isStalled,
      onProgress: () => {
        heartbeat.beat("queue", QUEUE_STALE_AFTER_MS);
      },
      ping: probe.ping,
      pingTimeoutMs: PING_TIMEOUT_MS,
    }).catch(() => false);
  }, PROBE_INTERVAL_MS);

  return () => {
    clearInterval(timer);
  };
};

export { createQueueJobFlow, startLiveness, startQueueProbe };
