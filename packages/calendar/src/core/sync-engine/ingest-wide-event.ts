import type { IngestWideEventFields } from "./ingest";

/*
 * The ingestion engine emits its own wide event describing the diff it applied.
 * A caller that already owns an enclosing wide event owns these fields too, so
 * merging them would overwrite the caller's own outcome and timing.
 */
const JOB_OWNED_WIDE_EVENT_KEYS = new Set([
  "duration_ms",
  "error.message",
  "error.type",
  "operation.name",
  "operation.type",
  "outcome",
]);

const selectIngestWideEventFields = (
  event: IngestWideEventFields,
): IngestWideEventFields =>
  Object.fromEntries(
    Object.entries(event).filter(([key]) => !JOB_OWNED_WIDE_EVENT_KEYS.has(key)),
  );

export { JOB_OWNED_WIDE_EVENT_KEYS, selectIngestWideEventFields };
