import type { Instant } from "@keeper.sh/sync-protocol";
import type { GoogleFailure } from "./classify";

const recordOf = (value: unknown): Record<string, unknown> | null => {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  return { ...value };
};

const statusOf = (carried: Record<string, unknown>): number | null => {
  if (typeof carried.status !== "number" || !Number.isFinite(carried.status)) {
    return null;
  }
  return carried.status;
};

const retryAfterOf = (carried: Record<string, unknown>): Instant | null => {
  const instant = recordOf(carried.retryAfter);
  if (instant?.kind !== "instant" || typeof instant.value !== "string") {
    return null;
  }
  return { kind: "instant", value: instant.value };
};

const transportFailure = (carried: Record<string, unknown>): GoogleFailure => {
  if (carried.disposition === "transient") {
    return { kind: "transient", status: statusOf(carried) };
  }
  return { kind: "permanent", status: statusOf(carried) };
};

const failureOfKind = (carried: Record<string, unknown>): GoogleFailure | null => {
  switch (carried.kind) {
    case "rateLimited": {
      return { kind: "rateLimited", retryAfter: retryAfterOf(carried) };
    }
    case "transport": {
      return transportFailure(carried);
    }
    case "cursorInvalid": {
      return { kind: "cursorLost" };
    }
    case "reauthRequired": {
      return { kind: "authExpired" };
    }
    case "notFound": {
      return { kind: "notFound" };
    }
    case "unsupported": {
      return { kind: "unsupported" };
    }
    case "conflict": {
      return { kind: "conflict" };
    }
    default: {
      return null;
    }
  }
};

const gateFailureOf = (error: unknown): GoogleFailure | null => {
  const carried = recordOf(recordOf(error)?.failure);
  if (carried === null) {
    return null;
  }
  return failureOfKind(carried);
};

export { gateFailureOf };
