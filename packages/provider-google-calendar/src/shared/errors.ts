import { HTTP_STATUS } from "@keeper.sh/constants";
import type { GoogleApiError } from "../types";

const hasRateLimitMessage = (message: string | undefined): boolean => {
  if (!message) {
    return false;
  }
  return message.includes("429") || message.includes("rateLimitExceeded");
};

const isAuthError = (status: number, error: GoogleApiError | undefined): boolean => {
  if (status === HTTP_STATUS.FORBIDDEN && error?.status === "PERMISSION_DENIED") {
    return true;
  }
  if (status === HTTP_STATUS.UNAUTHORIZED && error?.status === "UNAUTHENTICATED") {
    return true;
  }
  return false;
};

const isSimpleAuthError = (status: number): boolean => status === 401 || status === 403;

export { hasRateLimitMessage, isAuthError, isSimpleAuthError };
