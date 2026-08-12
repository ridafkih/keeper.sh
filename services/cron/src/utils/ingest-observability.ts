import { classifyDatabaseError, getDatabaseErrorDetails } from "@keeper.sh/database";

const INGEST_EVENT_FIELD_MAP = {
  "duration_ms": "ingest.duration_ms",
  "error.type": "ingest.error.type",
  "events.added": "ingest.events.added",
  "events.removed": "ingest.events.removed",
  "existing_events.count": "ingest.existing_events.count",
  "flushed": "ingest.flushed",
  "outcome": "ingest.outcome",
  "source_events.count": "ingest.source_events.count",
  "stored_events.invalid_count": "ingest.stored_events.invalid_count",
} as const;

type ObservableValue = boolean | number | string;

interface DatabaseErrorObservability {
  error: Error;
  fields: Record<string, string>;
  slug: string;
}

const getDatabaseErrorObservability = (
  error: unknown,
): DatabaseErrorObservability | null => {
  const classification = classifyDatabaseError(error);
  const isQueryError = error instanceof Error && error.message.startsWith("Failed query:");
  if (!classification && !isQueryError) {
    return null;
  }

  const details = getDatabaseErrorDetails(error);
  const fields: Record<string, string> = {};
  if (details?.sqlState) {
    fields["error.database.sqlstate"] = details.sqlState;
  }
  if (details?.constraint) {
    fields["error.database.constraint"] = details.constraint;
  }
  if (details?.schema) {
    fields["error.database.schema"] = details.schema;
  }
  if (details?.table) {
    fields["error.database.table"] = details.table;
  }
  if (details?.column) {
    fields["error.database.column"] = details.column;
  }
  if (details?.dataType) {
    fields["error.database.data_type"] = details.dataType;
  }

  const safeError = new Error("Database query failed");
  safeError.name = "DatabaseError";
  if (error instanceof Error) {
    safeError.name = error.name;
  }

  return {
    error: safeError,
    fields,
    slug: classification?.slug ?? "db-query-failed",
  };
};

const getIngestEventObservability = (
  event: Record<string, unknown>,
): Record<string, ObservableValue> => {
  const fields: Record<string, ObservableValue> = {};

  for (const [sourceKey, destinationKey] of Object.entries(INGEST_EVENT_FIELD_MAP)) {
    const value = event[sourceKey];
    if (
      typeof value === "boolean"
      || typeof value === "number"
      || typeof value === "string"
    ) {
      fields[destinationKey] = value;
    }
  }

  return fields;
};

export { getDatabaseErrorObservability, getIngestEventObservability };
export type { DatabaseErrorObservability, ObservableValue };
