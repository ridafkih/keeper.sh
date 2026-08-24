import { SIGNAL_READER_HEARTBEAT_KEY } from "@keeper.sh/calendar";

/*
 * Longer than the blocking read's own timeout, so a reader that is merely waiting still
 * looks alive, and short enough that one which died is reported down within a tick or two.
 */
const HEARTBEAT_TTL_SECONDS = 30;

interface HeartbeatWriter {
  setex: (key: string, seconds: number, value: string) => Promise<unknown>;
}

interface HeartbeatReader {
  get: (key: string) => Promise<string | null>;
}

interface SignalReaderState {
  reads: number;
  running: boolean;
}

/*
 * Redis rather than a variable: the reader and the drain tick that reports on it are not
 * guaranteed to share a process, and a value in memory reads as "never started" from
 * anywhere else — which is indistinguishable from a reader that genuinely never started.
 */
const recordSignalReaderHeartbeat = async (
  redis: HeartbeatWriter,
  reads: number,
): Promise<void> => {
  await redis
    .setex(SIGNAL_READER_HEARTBEAT_KEY, HEARTBEAT_TTL_SECONDS, String(reads))
    .catch(() => null);
};

const describeSignalReader = async (
  redis: HeartbeatReader,
): Promise<SignalReaderState> => {
  const beat = await redis.get(SIGNAL_READER_HEARTBEAT_KEY).catch(() => null);
  if (beat === null) {
    return { reads: 0, running: false };
  }
  const reads = Number(beat);
  if (!Number.isFinite(reads)) {
    return { reads: 0, running: true };
  }
  return { reads, running: true };
};

export { describeSignalReader, HEARTBEAT_TTL_SECONDS, recordSignalReaderHeartbeat };
export type { HeartbeatReader, HeartbeatWriter, SignalReaderState };
