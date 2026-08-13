import { isDatabaseError } from "@keeper.sh/database";

const AUTH_ERROR_STATUS_CODES = new Set([401]);

const AUTH_ERROR_PATTERNS = [
  /\binvalid credentials\b/i,
  /\b(?:401|authentication)\s+unauthorized\b/i,
  /\bauthentication required\b/i,
  /\bauthentication failed\b/i,
  /\bnot authenticated\b/i,
];

const CALDAV_AUTH_ERROR_NAME = "CalDAVAuthenticationError";

const CALDAV_TRANSPORT_ERROR_NAMES = new Set(["Error", CALDAV_AUTH_ERROR_NAME]);

const CALDAV_NON_AUTH_ERROR_NAMES = new Set(["CalDAVWithheldCredentialsError"]);

const HTTP_FAILURE_STATUS_PATTERN =
  /(?:\bhttp\/\d(?:\.\d)?\s+|\bstatus(?:\s*code)?\b\s*[:=]?\s*|\bfailed\b\s*(?:with\s+)?[:=]?\s*)([45]\d{2})(?!\d)/gi;

const SQLSTATE_PATTERN = /^[0-9A-Z]{5}$/;

const DATABASE_ERROR_NAMES = new Set(["DrizzleQueryError", "PostgresError"]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const hasSqlState = (value: unknown): boolean =>
  typeof value === "string" && SQLSTATE_PATTERN.test(value);

const isDatabaseFailure = (value: Record<string, unknown>): boolean => {
  if (typeof value.name === "string" && DATABASE_ERROR_NAMES.has(value.name)) {
    return true;
  }
  return hasSqlState(value.errno) || hasSqlState(value.code);
};

const toStatusCode = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (Number.isInteger(parsed)) {
      return parsed;
    }
  }

  return null;
};

const hasAuthStatusCode = (value: unknown): boolean => {
  const statusCode = toStatusCode(value);
  if (statusCode === null) {
    return false;
  }
  return AUTH_ERROR_STATUS_CODES.has(statusCode);
};

const namesNonAuthHttpFailure = (message: string): boolean => {
  const statuses = [...message.matchAll(HTTP_FAILURE_STATUS_PATTERN)]
    .map(([, status]) => Number(status));
  if (statuses.length === 0) {
    return false;
  }
  return !statuses.some((status) => AUTH_ERROR_STATUS_CODES.has(status));
};

const hasAuthMessage = (message: string): boolean =>
  AUTH_ERROR_PATTERNS.some((pattern) => pattern.test(message))
  && !namesNonAuthHttpFailure(message);

const isCalDAVTransportCandidate = (value: Record<string, unknown>): boolean =>
  typeof value.name !== "string" || CALDAV_TRANSPORT_ERROR_NAMES.has(value.name);

const collectNestedCandidates = (value: Record<string, unknown>): unknown[] => {
  const candidates: unknown[] = [];

  if ("cause" in value) {
    candidates.push(value.cause);
  }

  if ("error" in value) {
    candidates.push(value.error);
  }

  if ("errors" in value && Array.isArray(value.errors)) {
    candidates.push(...value.errors);
  }

  if ("Error" in value) {
    candidates.push(value.Error);
  }

  if ("messages" in value && Array.isArray(value.messages)) {
    candidates.push(...value.messages);
  }

  return candidates;
};

const isOpaqueToAuthClassification = (candidate: Record<string, unknown>): boolean =>
  isDatabaseFailure(candidate)
  || (typeof candidate.name === "string" && CALDAV_NON_AUTH_ERROR_NAMES.has(candidate.name));

const namesAuthFailure = (candidate: Record<string, unknown>): boolean => {
  if (candidate.name === CALDAV_AUTH_ERROR_NAME) {
    return true;
  }

  if ("status" in candidate && hasAuthStatusCode(candidate.status)) {
    return true;
  }

  if ("statusCode" in candidate && hasAuthStatusCode(candidate.statusCode)) {
    return true;
  }

  return isCalDAVTransportCandidate(candidate)
    && typeof candidate.message === "string"
    && hasAuthMessage(candidate.message);
};

const isCalDAVAuthenticationError = (error: unknown): boolean => {
  // A query error's message inlines the SQL and its bound parameters, so customer data can match AUTH_ERROR_PATTERNS.
  if (isDatabaseError(error)) {
    return false;
  }

  const queue: unknown[] = [error];
  const visited = new Set<unknown>();

  while (queue.length > 0) {
    const candidate = queue.shift();
    if (!candidate) {
      continue;
    }

    if (typeof candidate === "string") {
      if (hasAuthMessage(candidate)) {
        return true;
      }
      continue;
    }

    if (!isRecord(candidate)) {
      if (candidate instanceof Error && hasAuthMessage(candidate.message)) {
        return true;
      }
      continue;
    }

    if (visited.has(candidate)) {
      continue;
    }
    visited.add(candidate);

    if (isOpaqueToAuthClassification(candidate)) {
      continue;
    }

    if (namesAuthFailure(candidate)) {
      return true;
    }

    queue.push(...collectNestedCandidates(candidate));
  }

  return false;
};

export { isCalDAVAuthenticationError };
