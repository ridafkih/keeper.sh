interface DecodedGraphError {
  readonly status: number | null;
  readonly code: string | null;
  readonly retryAfter: string | null;
}

const carriedFailureStatuses = [
  { kind: "rateLimited", status: 429 },
  { kind: "cursorInvalid", status: 410 },
  { kind: "reauthRequired", status: 401 },
  { kind: "notFound", status: 404 },
  { kind: "conflict", status: 412 },
  { kind: "unsupported", status: 501 },
] as const;

const readProperty = (value: unknown, name: string): unknown => {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  try {
    return Reflect.get(value, name);
  } catch {
    return null;
  }
};

const finiteNumber = (value: unknown): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return value;
};

const nonEmptyText = (value: unknown): string | null => {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  return value;
};

const isHeaders = (value: unknown): value is Headers => value instanceof Headers;

const headerNamed = (carrier: unknown, name: string): string | null => {
  const headers = readProperty(carrier, "headers");
  if (isHeaders(headers)) {
    return nonEmptyText(headers.get(name));
  }
  return nonEmptyText(readProperty(headers, name));
};

const instantText = (value: unknown): string | null => {
  if (readProperty(value, "kind") !== "instant") {
    return nonEmptyText(value);
  }
  return nonEmptyText(readProperty(value, "value"));
};

const decodeCarriedFailure = (carrier: unknown): DecodedGraphError | null => {
  const kind = readProperty(carrier, "kind");
  const named = carriedFailureStatuses.find((entry) => entry.kind === kind);
  if (named) {
    return {
      status: named.status,
      code: named.kind,
      retryAfter: instantText(readProperty(carrier, "retryAfter")),
    };
  }
  if (kind !== "transport") {
    return null;
  }
  return {
    status: finiteNumber(readProperty(carrier, "status")),
    code: nonEmptyText(readProperty(carrier, "disposition")),
    retryAfter: null,
  };
};

const bodyCodeOf = (carrier: unknown): string | null => {
  const body = readProperty(carrier, "body");
  return (
    nonEmptyText(readProperty(readProperty(body, "error"), "code")) ??
    nonEmptyText(readProperty(readProperty(readProperty(body, "value"), "error"), "code"))
  );
};

const statusOf = (carrier: unknown): number | null =>
  finiteNumber(readProperty(carrier, "statusCode")) ?? finiteNumber(readProperty(carrier, "status"));

const decodeGraphError = (error: unknown): DecodedGraphError => {
  const carried = decodeCarriedFailure(readProperty(error, "failure"));
  if (carried !== null) {
    return carried;
  }
  return {
    status: statusOf(error),
    code: nonEmptyText(readProperty(error, "code")) ?? bodyCodeOf(error),
    retryAfter: headerNamed(error, "retry-after") ?? instantText(readProperty(error, "retryAfter")),
  };
};

export { decodeGraphError };
export type { DecodedGraphError };
