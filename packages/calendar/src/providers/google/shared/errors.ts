import { HTTP_STATUS } from "@keeper.sh/constants";
import { googleApiErrorSchema } from "@keeper.sh/data-schemas";
import type { GoogleApiError } from "../types";

const GOOGLE_PERMISSION_REAUTH_REASONS = new Set([
  "access_token_scope_insufficient",
  "insufficientpermissions",
]);

const GOOGLE_FORBIDDEN_AUTH_REASONS = new Set([
  "autherror",
  "invalidcredentials",
  "loginrequired",
]);

const hasRateLimitMessage = (message: string | undefined): boolean => {
  if (!message) {
    return false;
  }
  return message.includes("429") || message.includes("rateLimitExceeded");
};

const normalizeReason = (reason: string): string => reason.toLowerCase();

const getErrorReasons = (error: GoogleApiError | undefined): string[] => {
  if (!error) {
    return [];
  }

  const reasons: string[] = [];

  for (const entry of error.errors ?? []) {
    if (entry.reason) {
      reasons.push(normalizeReason(entry.reason));
    }
  }

  for (const entry of error.details ?? []) {
    if (entry.reason) {
      reasons.push(normalizeReason(entry.reason));
    }
  }

  return reasons;
};

const hasReason = (error: GoogleApiError | undefined, reasonSet: Set<string>): boolean => {
  const reasons = getErrorReasons(error);
  return reasons.some((reason) => reasonSet.has(reason));
};

const isAuthError = (status: number, error: GoogleApiError | undefined): boolean => {
  if (
    status === HTTP_STATUS.FORBIDDEN
    && error?.status === "PERMISSION_DENIED"
    && (
      hasReason(error, GOOGLE_PERMISSION_REAUTH_REASONS)
      || hasReason(error, GOOGLE_FORBIDDEN_AUTH_REASONS)
    )
  ) {
    return true;
  }
  if (status === HTTP_STATUS.UNAUTHORIZED && error?.status === "UNAUTHENTICATED") {
    return true;
  }
  return false;
};

const isSimpleAuthError = (status: number): boolean => status === 401 || status === 403;

const RATE_LIMIT_REASONS = new Set([
  "ratelimitexceeded",
  "userratelimitexceeded",
  "rate_limit_exceeded",
]);

const isRateLimitResponseStatus = (status: number): boolean =>
  status === HTTP_STATUS.FORBIDDEN || status === HTTP_STATUS.TOO_MANY_REQUESTS;

const isRateLimitApiError = (status: number, error?: GoogleApiError): boolean => {
  if (!isRateLimitResponseStatus(status)) {
    return false;
  }
  if (status === HTTP_STATUS.TOO_MANY_REQUESTS) {
    return true;
  }
  if (hasReason(error, RATE_LIMIT_REASONS)) {
    return true;
  }
  if (hasRateLimitMessage(error?.message)) {
    return true;
  }
  return false;
};

const EMPTY_API_ERROR: GoogleApiError = {};

const parseGoogleApiError = (text: string): GoogleApiError => {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!googleApiErrorSchema.allows(parsed)) {
      return EMPTY_API_ERROR;
    }
    return googleApiErrorSchema.assert(parsed).error ?? EMPTY_API_ERROR;
  } catch {
    return EMPTY_API_ERROR;
  }
};

const parseGoogleApiErrorFromBody = (body: unknown): GoogleApiError => {
  if (!googleApiErrorSchema.allows(body)) {
    return EMPTY_API_ERROR;
  }
  return googleApiErrorSchema.assert(body).error ?? EMPTY_API_ERROR;
};

export { hasRateLimitMessage, isAuthError, isRateLimitApiError, isRateLimitResponseStatus, isSimpleAuthError, parseGoogleApiError, parseGoogleApiErrorFromBody };
