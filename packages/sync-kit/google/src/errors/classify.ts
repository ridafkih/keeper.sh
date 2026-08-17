import type { Instant, OperationName, RemoteVersion } from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";

const googleErrorReasons = [
  "fullSyncRequired",
  "rateLimitExceeded",
  "userRateLimitExceeded",
  "quotaExceeded",
  "accessTokenScopeInsufficient",
  "authError",
  "loginRequired",
  "duplicate",
  "conditionNotMet",
  "notFound",
  "deleted",
  "forbiddenForNonOrganizer",
] as const;

type GoogleErrorReason = (typeof googleErrorReasons)[number];

type GoogleFailure =
  | { readonly kind: "cursorLost" }
  | { readonly kind: "resourceGone" }
  | { readonly kind: "rateLimited"; readonly retryAfter: Instant | null }
  | { readonly kind: "conflict" }
  | { readonly kind: "preconditionFailed"; readonly version: RemoteVersion | null }
  | { readonly kind: "authExpired" }
  | { readonly kind: "notFound" }
  | { readonly kind: "unsupported" }
  | { readonly kind: "transient"; readonly status: number | null }
  | { readonly kind: "permanent"; readonly status: number | null };

interface DecodedGoogleError {
  readonly status: number | null;
  readonly reasons: readonly string[];
  readonly retryAfter: Instant | null;
}

const throttlingReasons: readonly GoogleErrorReason[] = [
  "rateLimitExceeded",
  "userRateLimitExceeded",
  "quotaExceeded",
];

const reauthReasons: readonly GoogleErrorReason[] = [
  "authError",
  "loginRequired",
  "accessTokenScopeInsufficient",
];

const namedReasons = (decoded: DecodedGoogleError): readonly GoogleErrorReason[] =>
  decoded.reasons.flatMap((reason) =>
    googleErrorReasons.filter((candidate) => candidate === reason),
  );

const includesAny = (
  named: readonly GoogleErrorReason[],
  wanted: readonly GoogleErrorReason[],
): boolean => named.some((reason) => wanted.includes(reason));

const forbidden = (decoded: DecodedGoogleError): GoogleFailure => {
  const named = namedReasons(decoded);
  if (includesAny(named, reauthReasons)) {
    return { kind: "authExpired" };
  }
  if (includesAny(named, throttlingReasons)) {
    return { kind: "rateLimited", retryAfter: null };
  }
  if (decoded.reasons.length === 0) {
    return { kind: "rateLimited", retryAfter: null };
  }
  return { kind: "permanent", status: 403 };
};

const goneOn = (operation: OperationName): GoogleFailure => {
  switch (operation) {
    case "listChanges": {
      return { kind: "cursorLost" };
    }
    case "listCalendars":
    case "normalize":
    case "write": {
      return { kind: "resourceGone" };
    }
    default: {
      return assertNever(operation);
    }
  }
};

const isServerSide = (status: number): boolean => status >= 500 && status <= 599;

const classifyGoogleError = (
  decoded: DecodedGoogleError,
  operation: OperationName,
): GoogleFailure => {
  const { status } = decoded;
  if (status === null) {
    return { kind: "transient", status: null };
  }
  if (status === 401) {
    return { kind: "authExpired" };
  }
  if (status === 403) {
    return forbidden(decoded);
  }
  if (status === 404) {
    return { kind: "notFound" };
  }
  if (status === 409) {
    return { kind: "conflict" };
  }
  if (status === 410) {
    return goneOn(operation);
  }
  if (status === 412) {
    return { kind: "preconditionFailed", version: null };
  }
  if (status === 429) {
    return { kind: "rateLimited", retryAfter: decoded.retryAfter };
  }
  if (isServerSide(status)) {
    return { kind: "transient", status };
  }
  return { kind: "permanent", status };
};

const isRetryable = (failure: GoogleFailure): boolean => {
  switch (failure.kind) {
    case "rateLimited":
    case "transient": {
      return true;
    }
    case "cursorLost":
    case "resourceGone":
    case "conflict":
    case "preconditionFailed":
    case "authExpired":
    case "notFound":
    case "unsupported":
    case "permanent": {
      return false;
    }
    default: {
      return assertNever(failure);
    }
  }
};

export { classifyGoogleError, googleErrorReasons, isRetryable };
export type { DecodedGoogleError, GoogleErrorReason, GoogleFailure };
