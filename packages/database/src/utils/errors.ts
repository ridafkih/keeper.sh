// SQLSTATE 57014 (query_canceled) — Postgres raises this when statement_timeout fires.
const STATEMENT_TIMEOUT_SQLSTATE = "57014";
// Bun's code for a backend terminated mid-flight (idle-in-transaction timeout, shutdown, drop).
const CONNECTION_TERMINATED_CODE = "ERR_POSTGRES_EXPECTED_REQUEST";

interface DatabaseErrorClassification {
  slug: string;
  sqlState: string | null;
}

interface DatabaseErrorDetails {
  constraint: string | null;
  detail: string | null;
  message: string | null;
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

const readString = (value: unknown): string | null => {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  return null;
};

const getDatabaseErrorDetails = (error: unknown): DatabaseErrorDetails | null => {
  const cause = readCause(error);
  if (!cause) {
    return null;
  }

  const details = {
    constraint: readString(cause.constraint),
    detail: readString(cause.detail),
    message: readString(cause.message),
    sqlState: readString(cause.errno) ?? readString(cause.code),
  };
  if (Object.values(details).every((value) => value === null)) {
    return null;
  }
  return details;
};

const classifyDatabaseError = (error: unknown): DatabaseErrorClassification | null => {
  const cause = readCause(error);
  if (cause && String(cause.errno) === STATEMENT_TIMEOUT_SQLSTATE) {
    return { slug: "db-statement-timeout", sqlState: STATEMENT_TIMEOUT_SQLSTATE };
  }

  const connectionTerminated = (
    isRecord(error) && error.code === CONNECTION_TERMINATED_CODE
  ) || cause?.code === CONNECTION_TERMINATED_CODE;
  if (connectionTerminated) {
    return { slug: "db-connection-terminated", sqlState: null };
  }

  return null;
};

export { classifyDatabaseError, getDatabaseErrorDetails };
export type { DatabaseErrorClassification, DatabaseErrorDetails };
