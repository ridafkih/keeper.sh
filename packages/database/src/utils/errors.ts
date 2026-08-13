const STATEMENT_TIMEOUT_SQLSTATE = "57014";
const CONNECTION_TERMINATED_CODE = "ERR_POSTGRES_EXPECTED_REQUEST";
const CONNECTION_UNAVAILABLE_CODES = new Set([
  "ERR_POSTGRES_CONNECTION_CLOSED",
  "ERR_POSTGRES_CONNECTION_TIMEOUT",
  "ERR_POSTGRES_IDLE_TIMEOUT",
  "ERR_POSTGRES_LIFETIME_TIMEOUT",
]);
const CONNECTION_UNAVAILABLE_SQLSTATES = new Set([
  "08000",
  "08001",
  "08003",
  "08004",
  "08006",
  "08007",
  "25P03",
  "53300",
  "57P01",
  "57P02",
  "57P03",
  "57P05",
]);

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

const readField = (value: unknown, field: string): string | null => {
  if (!isRecord(value)) {
    return null;
  }
  return readString(value[field]);
};

const readFromErrorOrCause = (
  error: unknown,
  cause: Record<string, unknown> | null,
  field: string,
): string | null => readField(error, field) ?? readField(cause, field);

const hasDriverCode = (
  error: unknown,
  cause: Record<string, unknown> | null,
  matches: (code: string) => boolean,
): boolean => {
  const directCode = readField(error, "code");
  if (directCode !== null && matches(directCode)) {
    return true;
  }

  const causeCode = readField(cause, "code");
  if (causeCode !== null && matches(causeCode)) {
    return true;
  }

  return false;
};

const isConnectionTerminatedCode = (code: string): boolean =>
  code === CONNECTION_TERMINATED_CODE;

const isConnectionUnavailableCode = (code: string): boolean =>
  CONNECTION_UNAVAILABLE_CODES.has(code);

const classifyDatabaseError = (error: unknown): DatabaseErrorClassification | null => {
  const cause = readCause(error);
  const sqlState = readFromErrorOrCause(error, cause, "errno");

  if (sqlState === STATEMENT_TIMEOUT_SQLSTATE) {
    return { slug: "db-statement-timeout", sqlState: STATEMENT_TIMEOUT_SQLSTATE };
  }

  if (hasDriverCode(error, cause, isConnectionTerminatedCode)) {
    return { slug: "db-connection-terminated", sqlState: null };
  }

  if (hasDriverCode(error, cause, isConnectionUnavailableCode)) {
    return { slug: "db-connection-unavailable", sqlState: null };
  }

  if (sqlState !== null && CONNECTION_UNAVAILABLE_SQLSTATES.has(sqlState)) {
    return { slug: "db-connection-unavailable", sqlState };
  }

  return null;
};

export { classifyDatabaseError, getDatabaseErrorDetails };
export type { DatabaseErrorClassification, DatabaseErrorDetails };
