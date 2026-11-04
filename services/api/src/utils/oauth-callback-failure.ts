import type { OAuthConnectFailureReason } from "@keeper.sh/data-schemas";

interface ProviderFailure {
  error: string;
  errorDescription?: string | null;
}

const ADMIN_APPROVAL_CODES = ["AADSTS65001", "AADSTS90094", "AADSTS900941", "AADSTS90095"];
const DECLINED_CONSENT_CODES = ["AADSTS65004"];
const ACCESS_DENIED_ERROR = "access_denied";

const describesAny = (description: string, codes: string[]): boolean =>
  codes.some((code) => description.includes(`${code}:`));

const resolveProviderFailureReason = ({
  error,
  errorDescription,
}: ProviderFailure): OAuthConnectFailureReason => {
  const description = errorDescription ?? "";
  if (describesAny(description, ADMIN_APPROVAL_CODES)) {
    return "admin-approval-required";
  }
  if (describesAny(description, DECLINED_CONSENT_CODES) || error === ACCESS_DENIED_ERROR) {
    return "access-declined";
  }
  return "unknown";
};

export { resolveProviderFailureReason };
