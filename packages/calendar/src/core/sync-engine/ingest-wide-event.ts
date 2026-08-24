import type { IngestWideEventFields } from "./ingest";

const JOB_OWNED_WIDE_EVENT_KEYS = new Set([
  "error.message",
  "error.type",
  "operation.name",
  "operation.type",
]);

/*
 * Namespaced rather than dropped: "superseded" and "unchanged" both leave
 * `flushed` false, and only `ingest.outcome` tells them apart.
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
