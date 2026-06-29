// SQLSTATE 57014 (query_canceled) — Postgres raises this when statement_timeout fires.
const STATEMENT_TIMEOUT_SQLSTATE = "57014";
// Bun's code for a backend terminated mid-flight (idle-in-transaction timeout, shutdown, drop).
const CONNECTION_TERMINATED_CODE = "ERR_POSTGRES_EXPECTED_REQUEST";

interface DatabaseErrorClassification {
  slug: string;
  sqlState: string | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const readCause = (error: unknown): Record<string, unknown> | null => {
  if (isRecord(error) && isRecord(error.cause)) {
    return error.cause;
  }
  return null;
};

const classifyDatabaseError = (error: unknown): DatabaseErrorClassification | null => {
  const cause = readCause(error);
  if (cause && String(cause.errno) === STATEMENT_TIMEOUT_SQLSTATE) {
    return { slug: "db-statement-timeout", sqlState: STATEMENT_TIMEOUT_SQLSTATE };
  }

  if (isRecord(error) && error.code === CONNECTION_TERMINATED_CODE) {
    return { slug: "db-connection-terminated", sqlState: null };
  }

  return null;
};

export { classifyDatabaseError };
export type { DatabaseErrorClassification };
