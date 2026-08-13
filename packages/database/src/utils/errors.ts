const SQLSTATE_PATTERN = /^[0-9A-Z]{5}$/;
const SQLSTATE_CLASSES = new Set([
  "00", "01", "02", "03", "07", "08", "09", "0A", "0B", "0F", "0K", "0L", "0N",
  "0P", "0S", "0T", "0U", "0V", "0W", "0X", "0Y", "0Z", "10", "20", "21", "22",
  "23", "24", "25", "26", "27", "28", "2B", "2C", "2D", "2E", "2F", "2H", "30",
  "33", "34", "35", "36", "38", "39", "3B", "3C", "3D", "3F", "40", "42", "44",
  "45", "46", "53", "54", "55", "57", "58", "F0", "HV", "HW", "HZ", "P0", "XX",
]);
const DRIVER_CODE_PREFIX = "ERR_POSTGRES_";
const STATEMENT_TIMEOUT_SQLSTATE = "57014";
const UNCLASSIFIED_DATABASE_SLUG = "db-query-failed";
const CONNECTION_TERMINATED_CODE = "ERR_POSTGRES_EXPECTED_REQUEST";
const CONNECTION_UNAVAILABLE_CODES = new Set([
  "ERR_POSTGRES_CONNECTION_CLOSED",
  "ERR_POSTGRES_CONNECTION_TIMEOUT",
  "ERR_POSTGRES_IDLE_TIMEOUT",
  "ERR_POSTGRES_LIFETIME_TIMEOUT",
  "ERR_POSTGRES_TLS_NOT_AVAILABLE",
  "ERR_POSTGRES_TLS_UPGRADE_FAILED",
]);
const CONNECTION_UNAVAILABLE_SQLSTATES = new Set([
  "08000",
  "08001",
  "08003",
  "08004",
  "08006",
  "08007",
  "25P03",
  "28000",
  "28P01",
  "3D000",
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

interface DatabaseErrorSource extends DatabaseErrorClassification {
  link: unknown;
}

interface DatabaseErrorDetails {
  constraint: string | null;
  detail: string | null;
  message: string | null;
  sqlState: string | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const NESTED_ERROR_KEYS = ["cause", "error", "Error"];
const NESTED_ERROR_LIST_KEYS = ["errors", "messages"];

const readLinkedErrors = (error: unknown): unknown[] => {
  if (!isRecord(error)) {
    return [];
  }
  return [
    ...NESTED_ERROR_KEYS.flatMap((key) => {
      if (key in error) {
        return [error[key]];
      }
      return [];
    }),
    ...NESTED_ERROR_LIST_KEYS.flatMap((key) => {
      const value = error[key];
      if (Array.isArray(value)) {
        return value;
      }
      return [];
    }),
  ];
};

const readErrorChain = (error: unknown): unknown[] => {
  const chain: unknown[] = [];
  const seen = new Set<unknown>();
  const queue: unknown[] = [error];

  while (queue.length > 0) {
    const link = queue.shift();
    if (!isRecord(link) || seen.has(link)) {
      continue;
    }
    seen.add(link);
    chain.push(link);
    queue.push(...readLinkedErrors(link));
  }

  return chain;
};

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

const isSqlState = (value: string): boolean =>
  SQLSTATE_PATTERN.test(value) && SQLSTATE_CLASSES.has(value.slice(0, 2));

const readSqlState = (value: unknown): string | null => {
  const errno = readField(value, "errno");
  if (errno !== null && isSqlState(errno)) {
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

const isConnectionTerminatedCode = (code: string): boolean =>
  code === CONNECTION_TERMINATED_CODE;

const isConnectionUnavailableCode = (code: string): boolean =>
  CONNECTION_UNAVAILABLE_CODES.has(code);

const hasDriverCode = (link: unknown, matches: (code: string) => boolean): boolean => {
  const code = readField(link, "code");
  return code !== null && matches(code);
};

const findLink = (chain: unknown[], matches: (link: unknown) => boolean): unknown =>
  chain.find((link) => matches(link)) ?? null;

const classifyErrorChain = (chain: unknown[]): DatabaseErrorSource | null => {
  const timeoutLink = findLink(
    chain,
    (link) => readSqlState(link) === STATEMENT_TIMEOUT_SQLSTATE,
  );
  if (timeoutLink !== null) {
    return {
      link: timeoutLink,
      slug: "db-statement-timeout",
      sqlState: STATEMENT_TIMEOUT_SQLSTATE,
    };
  }

  const terminatedLink = findLink(
    chain,
    (link) => hasDriverCode(link, isConnectionTerminatedCode),
  );
  if (terminatedLink !== null) {
    return { link: terminatedLink, slug: "db-connection-terminated", sqlState: null };
  }

  const unavailableCodeLink = findLink(
    chain,
    (link) => hasDriverCode(link, isConnectionUnavailableCode),
  );
  if (unavailableCodeLink !== null) {
    return { link: unavailableCodeLink, slug: "db-connection-unavailable", sqlState: null };
  }

  const unavailableSqlStateLink = findLink(chain, (link) => {
    const sqlState = readSqlState(link);
    return sqlState !== null && CONNECTION_UNAVAILABLE_SQLSTATES.has(sqlState);
  });
  if (unavailableSqlStateLink !== null) {
    return {
      link: unavailableSqlStateLink,
      slug: "db-connection-unavailable",
      sqlState: readSqlState(unavailableSqlStateLink),
    };
  }

  return null;
};

const readDetailSource = (error: unknown): unknown => {
  const chain = readErrorChain(error);
  return classifyErrorChain(chain)?.link
    ?? chain.find((link) => isDatabaseErrorShape(link))
    ?? null;
};

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

const isDatabaseError = (error: unknown): boolean =>
  readErrorChain(error).some((link) => isDatabaseErrorShape(link));

const classifyDatabaseError = (error: unknown): DatabaseErrorClassification | null => {
  const source = classifyErrorChain(readErrorChain(error));
  if (source === null) {
    return null;
  }
  return { slug: source.slug, sqlState: source.sqlState };
};

const resolveDatabaseErrorClassification = (
  error: unknown,
): DatabaseErrorClassification | null => {
  const classification = classifyDatabaseError(error);
  if (classification !== null) {
    return classification;
  }
  if (!isDatabaseError(error)) {
    return null;
  }
  return {
    slug: UNCLASSIFIED_DATABASE_SLUG,
    sqlState: getDatabaseErrorDetails(error)?.sqlState ?? null,
  };
};

export {
  classifyDatabaseError,
  getDatabaseErrorDetails,
  isDatabaseError,
  resolveDatabaseErrorClassification,
};
export type { DatabaseErrorClassification, DatabaseErrorDetails };
