import { createConcurrencyGate, createSerialFlushWorker } from "@keeper.sh/calendar";
import type { ConcurrencyGate, FlushReservation, FlushWorkerDepth, IngestionResult, SerialFlushWorker } from "@keeper.sh/calendar";
import { flushDrainRegistry } from "@/context";
import { FLUSH_WRITER_CONNECTIONS } from "@/utils/flush-writer";
import { WEIGHT_BUDGET } from "@/utils/ingest-weight";

const DEFAULT_DATABASE_POOL_MAX = 10;
const CRON_DATABASE_POOL_MAX = Number(process.env.DATABASE_POOL_MAX ?? DEFAULT_DATABASE_POOL_MAX);
const POOL_CONNECTIONS_RESERVED_FOR_OTHER_JOBS = 5;
const INGEST_POOL_PERMITS = CRON_DATABASE_POOL_MAX - POOL_CONNECTIONS_RESERVED_FOR_OTHER_JOBS;

/*
 * Collection is concurrent but writing is not, so high fetch concurrency can never open
 * concurrent write transactions against Postgres. The bound matters as much as the
 * serialization: a bare promise chain would also serialize, but with nothing to stop an
 * unbounded backlog of fetched payloads queueing behind a slow flush.
 */
const FLUSH_QUEUE_CAPACITY = 50;

/*
 * A webhook-driven drain and the every-minute fleet pass run the same ingest, so sharing
 * one gate and one writer let a fanned-out fleet park push work behind it — measured
 * wait.db_pool_ms p90 18ms -> 31,479ms while the fleet drained its backlog. The lanes
 * divide the pool and the flush connections instead of each claiming all of them: the
 * point is that a saturated fleet cannot spend a push permit, not that push gets more.
 */
const PUSH_LANE_SHARE_DIVISOR = 4;
const PUSH_LANE_POOL_PERMITS = Math.max(
  1,
  Math.floor(INGEST_POOL_PERMITS / PUSH_LANE_SHARE_DIVISOR),
);
const FLEET_LANE_POOL_PERMITS = Math.max(1, INGEST_POOL_PERMITS - PUSH_LANE_POOL_PERMITS);
const PUSH_LANE_WRITER_CONNECTIONS = Math.floor(
  FLUSH_WRITER_CONNECTIONS / PUSH_LANE_SHARE_DIVISOR,
);
const FLEET_LANE_WRITER_CONNECTIONS = FLUSH_WRITER_CONNECTIONS - PUSH_LANE_WRITER_CONNECTIONS;

type IngestFlushWorker = SerialFlushWorker<() => Promise<IngestionResult>, IngestionResult>;
type IngestFlushReservation = FlushReservation<() => Promise<IngestionResult>, IngestionResult>;

interface IngestFlushWriter {
  close(): Promise<void>;
  depth(): FlushWorkerDepth;
  reserve(weight: number, signal?: AbortSignal): Promise<IngestFlushReservation>;
  submit<TResult>(task: () => Promise<TResult>, signal?: AbortSignal): Promise<TResult>;
}

interface IngestLane {
  flushWriter: IngestFlushWriter;
  pooledQueryGate: ConcurrencyGate;
}

const createIngestLane = (poolPermits: number, writerConnections: number): IngestLane => {
  /*
   * Memory-weighted rather than item-counted: a source reserves its estimated payload weight
   * BEFORE its fetch begins, so a full budget stops fetches and blocked collectors hold nothing.
   */
  const worker: IngestFlushWorker = createSerialFlushWorker(
    (task: () => Promise<IngestionResult>) => task(),
    {
      budget: WEIGHT_BUDGET,
      capacity: FLUSH_QUEUE_CAPACITY,
      writerConcurrency: writerConnections,
    },
  );
  flushDrainRegistry.register(() => worker.close());
  const flushWriter = worker as IngestFlushWriter;
  /*
   * Sources fan out unbounded and spend almost all of their time in provider I/O, but each
   * still makes a handful of short pooled reads before the weighted reserve can park it.
   * Gating those keeps concurrent queries inside the pool no matter how wide the fan-out.
   */
  return { flushWriter, pooledQueryGate: createConcurrencyGate(poolPermits) };
};

const fleetIngestLane = createIngestLane(FLEET_LANE_POOL_PERMITS, FLEET_LANE_WRITER_CONNECTIONS);
const pushIngestLane = createIngestLane(PUSH_LANE_POOL_PERMITS, PUSH_LANE_WRITER_CONNECTIONS);

export { fleetIngestLane, pushIngestLane };
export type { IngestFlushReservation, IngestLane };
