import { getEnabledSocialProviders } from "./auth-capabilities";
import type { AuthCapabilities, SocialProviderId } from "./auth-capabilities";

type AccountDeletionOutcome = "deleted" | "reauthentication-required";

type ReauthenticationMethod =
  | { kind: "passkey" }
  | { kind: "social"; provider: SocialProviderId };

interface AuthErrorLike {
  code?: string;
  message?: string;
}

interface ReauthenticationMethodsInput {
  capabilities: AuthCapabilities;
  linkedProviderIds: string[];
  passkeyCount: number;
}

const SESSION_EXPIRED_CODE = "SESSION_EXPIRED";
const REAUTHENTICATION_SEARCH_KEY = "delete";
const REAUTHENTICATION_SEARCH_VALUE = "confirm";
const ACCOUNT_DELETION_REAUTHENTICATION_PATH =
  `/dashboard/settings?${REAUTHENTICATION_SEARCH_KEY}=${REAUTHENTICATION_SEARCH_VALUE}`;

const resolveAccountDeletionOutcome = (error: AuthErrorLike | null): AccountDeletionOutcome => {
  if (!error) {
    return "deleted";
  }
  if (error.code === SESSION_EXPIRED_CODE) {
    return "reauthentication-required";
  }
  throw new Error(error.message ?? "Failed to delete account.");
};

const resolveReauthenticationMethods = ({
  capabilities,
  linkedProviderIds,
  passkeyCount,
}: ReauthenticationMethodsInput): ReauthenticationMethod[] => {
  const linked = new Set(linkedProviderIds);
  const socialMethods = getEnabledSocialProviders(capabilities)
    .filter((provider) => linked.has(provider))
    .map((provider): ReauthenticationMethod => ({ kind: "social", provider }));

  if (capabilities.supportsPasskeys && passkeyCount > 0) {
    return [{ kind: "passkey" }, ...socialMethods];
  }

  return socialMethods;
};

const readsAsReauthenticationReturn = (search: Record<string, unknown>): boolean =>
  search[REAUTHENTICATION_SEARCH_KEY] === REAUTHENTICATION_SEARCH_VALUE;

export {
  ACCOUNT_DELETION_REAUTHENTICATION_PATH,
  readsAsReauthenticationReturn,
  resolveAccountDeletionOutcome,
  resolveReauthenticationMethods,
};
export type { AccountDeletionOutcome, ReauthenticationMethod };
