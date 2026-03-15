import { HTTP_STATUS } from "@keeper.sh/constants";
import type { MicrosoftApiError } from "../types";

const hasRateLimitMessage = (message: string | undefined): boolean => {
  if (!message) {
    return false;
  }
  return message.includes("429") || message.includes("throttled");
};

const isAuthError = (status: number, error: MicrosoftApiError | undefined): boolean => {
  const code = error?.code;
  if (status === HTTP_STATUS.FORBIDDEN) {
    return code === "Authorization_RequestDenied" || code === "ErrorAccessDenied";
  }
  if (status === HTTP_STATUS.UNAUTHORIZED) {
    return code === "InvalidAuthenticationToken";
  }
  return false;
};

const isSimpleAuthError = (status: number): boolean => status === 401 || status === 403;

export { hasRateLimitMessage, isAuthError, isSimpleAuthError };
