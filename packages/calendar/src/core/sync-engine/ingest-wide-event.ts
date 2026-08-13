import type { IngestWideEventFields } from "./ingest";

/*
 * The ingestion engine emits its own wide event describing the diff it applied.
 * A caller that already owns an enclosing wide event owns these fields too, so
 * merging them would overwrite the caller's own identity and failure reporting.
 */
const JOB_OWNED_WIDE_EVENT_KEYS = new Set([
  "error.message",
  "error.type",
  "operation.name",
  "operation.type",
]);

/*
 * The engine's outcome and timing describe the ingestion alone and answer a
 * different question than the job's own: "superseded" and "unchanged" both
 * leave flushed false, and only this field tells them apart during a loss
 * investigation. They move under their own prefix rather than being dropped.
 */
const INGEST_NAMESPACED_WIDE_EVENT_KEYS = new Map([
  ["duration_ms", "ingest.duration_ms"],
  ["outcome", "ingest.outcome"],
]);

const selectIngestWideEventFields = (
  event: IngestWideEventFields,
): IngestWideEventFields =>
  Object.fromEntries(
    Object.entries(event)
      .filter(([key]) => !JOB_OWNED_WIDE_EVENT_KEYS.has(key))
      .map(([key, value]) => [INGEST_NAMESPACED_WIDE_EVENT_KEYS.get(key) ?? key, value]),
  );

export { JOB_OWNED_WIDE_EVENT_KEYS, selectIngestWideEventFields };
