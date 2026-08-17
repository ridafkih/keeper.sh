import type { Instant, OperationName } from "@keeper.sh/sync-protocol";
import { caldavCapabilities } from "../capabilities";
import type { DavPrecondition } from "./precondition";

type CalDAVFailure =
  | { readonly kind: "denied"; readonly operation: OperationName }
  | { readonly kind: "credentialsWithheld" }
  | { readonly kind: "throttled"; readonly retryAfter: Instant | null }
  | { readonly kind: "tokenRejected" }
  | { readonly kind: "truncated" }
  | { readonly kind: "preconditionFailed" }
  | { readonly kind: "absent" }
  | { readonly kind: "transient"; readonly status: number | null }
  | { readonly kind: "permanent"; readonly status: number | null };

interface ClassificationInput {
  readonly status: number | null;
  readonly precondition: DavPrecondition | null;
  readonly operation: OperationName;
  readonly retryAfter: Instant | null;
  readonly credentialsWithheld: boolean;
}

const unauthorised = 401;
const forbidden = 403;
const notFound = 404;
const gone = 410;
const preconditionFailed = 412;
const conflict = 409;
const tooManyRequests = 429;
const insufficientStorage = 507;
const serverErrorFloor = 500;

const promisedRetry = (input: ClassificationInput): boolean => {
  if (input.retryAfter === null) {
    return false;
  }
  return caldavCapabilities.throttleSignals.some((signal) => signal.status === input.status);
};

const rejectsToken = (input: ClassificationInput): boolean => {
  if (input.precondition !== "validSyncToken") {
    return false;
  }
  return input.status === forbidden || input.status === conflict;
};

const classifyCalDAVFailure = (input: ClassificationInput): CalDAVFailure => {
  if (input.credentialsWithheld) {
    return { kind: "credentialsWithheld" };
  }
  if (rejectsToken(input)) {
    return { kind: "tokenRejected" };
  }
  if (input.status === insufficientStorage || input.precondition === "numberOfMatchesWithinLimits") {
    return { kind: "truncated" };
  }
  if (input.status === unauthorised) {
    return { kind: "denied", operation: input.operation };
  }
  if (input.status === tooManyRequests || promisedRetry(input)) {
    return { kind: "throttled", retryAfter: input.retryAfter };
  }
  if (input.status === preconditionFailed) {
    return { kind: "preconditionFailed" };
  }
  if (input.status === notFound || input.status === gone) {
    return { kind: "absent" };
  }
  if (input.status === null) {
    return { kind: "transient", status: null };
  }
  if (input.status >= serverErrorFloor) {
    return { kind: "transient", status: input.status };
  }
  return { kind: "permanent", status: input.status };
};

export { classifyCalDAVFailure };
export type { CalDAVFailure, ClassificationInput };
