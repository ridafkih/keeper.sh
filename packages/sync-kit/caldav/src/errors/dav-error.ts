import type { Instant } from "@keeper.sh/sync-protocol";

interface DecodedDavError {
  readonly status: number | null;
  readonly precondition: string | null;
  readonly retryAfter: Instant | null;
  readonly depth: number;
}

const maximumCauseDepth = 32;

const isCarrier = (value: unknown): value is object =>
  typeof value === "object" && value !== null;

const statusIn = (carrier: object): number | null => {
  if ("status" in carrier && typeof carrier.status === "number") {
    return carrier.status;
  }
  if ("statusCode" in carrier && typeof carrier.statusCode === "number") {
    return carrier.statusCode;
  }
  return null;
};

const preconditionIn = (carrier: object): string | null => {
  if ("precondition" in carrier && typeof carrier.precondition === "string") {
    return carrier.precondition;
  }
  return null;
};

const instantIn = (carrier: object): Instant | null => {
  if (!("retryAfter" in carrier)) {
    return null;
  }
  const { retryAfter } = carrier;
  if (typeof retryAfter !== "object" || retryAfter === null) {
    return null;
  }
  if (!("kind" in retryAfter) || retryAfter.kind !== "instant") {
    return null;
  }
  if (!("value" in retryAfter) || typeof retryAfter.value !== "string") {
    return null;
  }
  return { kind: "instant", value: retryAfter.value };
};

const causeOf = (carrier: object): unknown => {
  if ("cause" in carrier) {
    return carrier.cause;
  }
  return null;
};

const decodeDavError = (thrown: unknown): DecodedDavError => {
  const seen = new Set<unknown>();
  const walk: { current: unknown; depth: number } = { current: thrown, depth: 0 };
  while (walk.depth <= maximumCauseDepth) {
    if (!isCarrier(walk.current) || seen.has(walk.current)) {
      return { status: null, precondition: null, retryAfter: null, depth: walk.depth };
    }
    seen.add(walk.current);
    const status = statusIn(walk.current);
    const precondition = preconditionIn(walk.current);
    if (status !== null || precondition !== null) {
      return { status, precondition, retryAfter: instantIn(walk.current), depth: walk.depth };
    }
    walk.current = causeOf(walk.current);
    walk.depth += 1;
  }
  return { status: null, precondition: null, retryAfter: null, depth: maximumCauseDepth };
};

export { decodeDavError };
export type { DecodedDavError };
