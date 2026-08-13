const SQLSTATE_PATTERN = /^[0-9A-Z]{5}$/;
const DRIVER_CODE_PREFIX = "ERR_POSTGRES_";
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

const MAX_CAUSE_DEPTH = 4;

const readCauseLinks = (error: unknown): unknown[] => {
  if (isRecord(error) && isRecord(error.cause)) {
    return [error.cause];
  }
  return [];
};

const readAggregateLinks = (error: unknown): unknown[] => {
  if (error instanceof AggregateError && Array.isArray(error.errors)) {
    return [...error.errors];
  }
  return [];
};

const readLinkedErrors = (error: unknown): unknown[] => [
  ...readCauseLinks(error),
  ...readAggregateLinks(error),
];

const collectErrorChain = (
  links: unknown[],
  depth: number,
  seen: Set<unknown>,
): unknown[] => {
  if (depth > MAX_CAUSE_DEPTH) {
    return [];
  }
  return links.flatMap((link) => {
    if (!isRecord(link) || seen.has(link)) {
      return [];
    }
    seen.add(link);
    return [link, ...collectErrorChain(readLinkedErrors(link), depth + 1, seen)];
  });
};

const readErrorChain = (error: unknown): unknown[] =>
  collectErrorChain([error], 0, new Set());

const readString = (value: unknown): string | null => {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  return null;
};

const readField = (value: unknown, field: string): string | null => {
  if (!isRecord(value)) {
    return null;
  }
  return readString(value[field]);
};

const readSqlState = (value: unknown): string | null => {
  const errno = readField(value, "errno");
  if (errno !== null && SQLSTATE_PATTERN.test(errno)) {
    return errno;
  }
  return null;
};

const isDatabaseErrorShape = (value: unknown): boolean => {
  if (readSqlState(value) !== null) {
    return true;
  }
  const code = readField(value, "code");
  return code !== null && code.startsWith(DRIVER_CODE_PREFIX);
};

const readDetailSource = (error: unknown): unknown =>
  readErrorChain(error).find((link) => isDatabaseErrorShape(link)) ?? null;

const getDatabaseErrorDetails = (error: unknown): DatabaseErrorDetails | null => {
  const source = readDetailSource(error);
  if (source === null) {
    return null;
  }

  const details = {
    constraint: readField(source, "constraint"),
    detail: readField(source, "detail"),
    message: readField(source, "message"),
    sqlState: readSqlState(source),
  };
  if (Object.values(details).every((value) => value === null)) {
    return null;
  }
  return details;
};

const isConnectionTerminatedCode = (code: string): boolean =>
  code === CONNECTION_TERMINATED_CODE;

const isConnectionUnavailableCode = (code: string): boolean =>
  CONNECTION_UNAVAILABLE_CODES.has(code);

const hasDriverCode = (chain: unknown[], matches: (code: string) => boolean): boolean =>
  chain.some((link) => {
    const code = readField(link, "code");
    return code !== null && matches(code);
  });

const readChainSqlStates = (chain: unknown[]): string[] =>
  chain
    .map((link) => readSqlState(link))
    .filter((sqlState): sqlState is string => sqlState !== null);

const classifyDatabaseError = (error: unknown): DatabaseErrorClassification | null => {
  const chain = readErrorChain(error);
  const sqlStates = readChainSqlStates(chain);

  if (sqlStates.includes(STATEMENT_TIMEOUT_SQLSTATE)) {
    return { slug: "db-statement-timeout", sqlState: STATEMENT_TIMEOUT_SQLSTATE };
  }

  if (hasDriverCode(chain, isConnectionTerminatedCode)) {
    return { slug: "db-connection-terminated", sqlState: null };
  }

  if (hasDriverCode(chain, isConnectionUnavailableCode)) {
    return { slug: "db-connection-unavailable", sqlState: null };
  }

  const connectionSqlState = sqlStates.find((value) =>
    CONNECTION_UNAVAILABLE_SQLSTATES.has(value)) ?? null;
  if (connectionSqlState !== null) {
    return { slug: "db-connection-unavailable", sqlState: connectionSqlState };
  }

  return null;
};

export { classifyDatabaseError, getDatabaseErrorDetails };
export type { DatabaseErrorClassification, DatabaseErrorDetails };
