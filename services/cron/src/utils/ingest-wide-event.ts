import type { IngestWideEventFields } from "@keeper.sh/calendar";

/*
 * The ingestion engine emits its own wide event describing the diff it applied.
 * The surrounding job already owns the outcome, timing and error fields, so only
 * the ingestion-specific fields are merged onto the active event.
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
