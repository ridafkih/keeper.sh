import type { Instant } from "@keeper.sh/sync-protocol";
import type { DecodedGoogleError } from "./classify";

const recordOf = (value: unknown): Record<string, unknown> | null => {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  return { ...value };
};

const numberOf = (value: unknown): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return value;
};

const statusOf = (carrier: Record<string, unknown>): number | null => {
  const response = recordOf(carrier.response);
  return (
    numberOf(carrier.status) ?? numberOf(response?.status) ?? numberOf(carrier.code) ?? null
  );
};

const reasonsOf = (carrier: Record<string, unknown>): readonly string[] => {
  const data = recordOf(recordOf(carrier.response)?.data);
  const reported = recordOf(data?.error)?.errors;
  if (!Array.isArray(reported)) {
    return [];
  }
  return reported.flatMap((entry: unknown) => {
    const reason = recordOf(entry)?.reason;
    if (typeof reason !== "string") {
      return [];
    }
    return [reason];
  });
};

const instantOf = (value: unknown): Instant | null => {
  const carried = recordOf(value);
  if (carried?.kind !== "instant" || typeof carried.value !== "string") {
    return null;
  }
  const parsed = Date.parse(carried.value);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return { kind: "instant", value: new Date(parsed).toISOString() };
};

const httpDateOf = (value: unknown): Instant | null => {
  if (typeof value !== "string" || !/[A-Za-z]/.test(value)) {
    return null;
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return { kind: "instant", value: new Date(parsed).toISOString() };
};

const retryAfterOf = (carrier: Record<string, unknown>): Instant | null => {
  const headers = recordOf(recordOf(carrier.response)?.headers);
  return instantOf(carrier.retryAfter) ?? httpDateOf(headers?.["retry-after"]);
};

const decodeGaxiosError = (error: unknown): DecodedGoogleError => {
  const carrier = recordOf(error);
  if (carrier === null) {
    return { status: null, reasons: [], retryAfter: null };
  }
  return {
    status: statusOf(carrier),
    reasons: reasonsOf(carrier),
    retryAfter: retryAfterOf(carrier),
  };
};

export { decodeGaxiosError };
