import type {
  Instant,
  OperationName,
  RemoteVersion,
  TransportDisposition,
} from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";
import type { MicrosoftClock } from "../dependencies";
import type { DecodedGraphError } from "./graph-error";
import { retryAfterInstant } from "./retry-after";

const microsoftFailureKinds = [
  "gone",
  "duplicate",
  "throttled",
  "authRequired",
  "notFound",
  "conflict",
  "unsupported",
  "transport",
] as const;

type MicrosoftFailureKind = (typeof microsoftFailureKinds)[number];

type MicrosoftFailure =
  | { readonly kind: "gone" }
  | { readonly kind: "duplicate" }
  | { readonly kind: "throttled"; readonly retryAfter: Instant | null }
  | { readonly kind: "authRequired" }
  | { readonly kind: "notFound" }
  | { readonly kind: "conflict"; readonly version: RemoteVersion | null }
  | { readonly kind: "unsupported"; readonly operation: OperationName }
  | {
      readonly kind: "transport";
      readonly status: number | null;
      readonly disposition: TransportDisposition;
    };

interface ClassifyOptions {
  readonly clock: MicrosoftClock;
  readonly retryAfterCeilingMs: number;
}

const graphStatuses = {
  unauthorized: 401,
  forbidden: 403,
  notFound: 404,
  duplicate: 409,
  gone: 410,
  preconditionFailed: 412,
  tooManyRequests: 429,
  notImplemented: 501,
  serviceUnavailable: 503,
  lowestServerSide: 500,
  highestServerSide: 599,
} as const;

const transportOf = (
  status: number | null,
  disposition: TransportDisposition,
): MicrosoftFailure => ({ kind: "transport", status, disposition });

const isServerSide = (status: number): boolean =>
  status >= graphStatuses.lowestServerSide && status <= graphStatuses.highestServerSide;

const throttledFrom = (
  decoded: DecodedGraphError,
  options: ClassifyOptions,
): MicrosoftFailure => ({
  kind: "throttled",
  retryAfter: retryAfterInstant(decoded.retryAfter, {
    clock: options.clock,
    ceilingMs: options.retryAfterCeilingMs,
  }),
});

const classifyGraphError = (
  decoded: DecodedGraphError,
  operation: OperationName,
  options: ClassifyOptions,
): MicrosoftFailure => {
  const { status } = decoded;
  if (status === null) {
    return transportOf(null, "transient");
  }
  if (status === graphStatuses.unauthorized || status === graphStatuses.forbidden) {
    return { kind: "authRequired" };
  }
  if (status === graphStatuses.notFound) {
    return { kind: "notFound" };
  }
  if (status === graphStatuses.duplicate) {
    return { kind: "duplicate" };
  }
  if (status === graphStatuses.gone) {
    return { kind: "gone" };
  }
  if (status === graphStatuses.preconditionFailed) {
    return { kind: "conflict", version: null };
  }
  if (status === graphStatuses.tooManyRequests || status === graphStatuses.serviceUnavailable) {
    return throttledFrom(decoded, options);
  }
  if (status === graphStatuses.notImplemented) {
    return { kind: "unsupported", operation };
  }
  if (isServerSide(status)) {
    return transportOf(status, "transient");
  }
  return transportOf(status, "permanent");
};

const isRetryable = (failure: MicrosoftFailure): boolean => {
  switch (failure.kind) {
    case "throttled": {
      return true;
    }
    case "transport": {
      return failure.disposition === "transient";
    }
    case "gone":
    case "duplicate":
    case "authRequired":
    case "notFound":
    case "conflict":
    case "unsupported": {
      return false;
    }
    default: {
      return assertNever(failure);
    }
  }
};

export { classifyGraphError, isRetryable, microsoftFailureKinds };
export type { ClassifyOptions, MicrosoftFailure, MicrosoftFailureKind };
