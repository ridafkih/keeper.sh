const AUTH_ERROR_STATUS_CODES = new Set([401, 403]);

const AUTH_ERROR_PATTERNS = [
  /\binvalid credentials\b/i,
  /\bunauthorized\b/i,
  /\bauthentication required\b/i,
  /\bauthentication failed\b/i,
  /\bnot authenticated\b/i,
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

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

const hasAuthMessage = (message: string): boolean =>
  AUTH_ERROR_PATTERNS.some((pattern) => pattern.test(message));

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

const isCalDAVAuthenticationError = (error: unknown): boolean => {
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

    if (isRecord(candidate)) {
      if (visited.has(candidate)) {
        continue;
      }
      visited.add(candidate);

      if ("status" in candidate && hasAuthStatusCode(candidate.status)) {
        return true;
      }

      if ("statusCode" in candidate && hasAuthStatusCode(candidate.statusCode)) {
        return true;
      }

      if ("message" in candidate && typeof candidate.message === "string" && hasAuthMessage(candidate.message)) {
        return true;
      }

      queue.push(...collectNestedCandidates(candidate));
      continue;
    }

    if (candidate instanceof Error && hasAuthMessage(candidate.message)) {
      return true;
    }
  }

  return false;
};

export { isCalDAVAuthenticationError };
