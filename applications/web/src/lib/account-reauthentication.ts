import { getEnabledSocialProviders } from "./auth-capabilities";
import type { AuthCapabilities, SocialProviderId } from "./auth-capabilities";

type AccountDeletionOutcome = "deleted" | "reauthentication-required";

type DeleteAccountStep = "confirm" | "reauthenticate";

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
const PASSKEY_CANCELLED_CODE = "AUTH_CANCELLED";
const WEBAUTHN_ERROR_CODE_PREFIX = "ERROR_";
const PASSKEY_BELONGS_TO_ANOTHER_ACCOUNT_CODE = "PASSKEY_BELONGS_TO_ANOTHER_ACCOUNT";
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

const isPasskeyCancellation = (code: string | undefined): boolean =>
  code === PASSKEY_CANCELLED_CODE || Boolean(code?.startsWith(WEBAUTHN_ERROR_CODE_PREFIX));

const resolveReauthenticationErrorMessage = (error: AuthErrorLike): string => {
  if (error.code === PASSKEY_BELONGS_TO_ANOTHER_ACCOUNT_CODE) {
    return "That passkey belongs to a different account.";
  }
  if (isPasskeyCancellation(error.code)) {
    return "Passkey cancelled.";
  }
  return "Couldn't confirm it's you.";
};

interface DeleteAccountDescriptionInput {
  methodCount: number;
  step: DeleteAccountStep;
}

const resolveDeleteAccountDescription = ({
  methodCount,
  step,
}: DeleteAccountDescriptionInput): string => {
  if (step === "confirm") {
    return "This action is permanent and cannot be undone. All of your data, calendars, and connected accounts will be permanently deleted.";
  }
  if (methodCount === 0) {
    return "Sign out and back in, then delete your account.";
  }
  return "Sign in again to confirm it's you, then delete your account.";
};

const readsAsReauthenticationReturn = (search: Record<string, unknown>): boolean =>
  search[REAUTHENTICATION_SEARCH_KEY] === REAUTHENTICATION_SEARCH_VALUE;

export {
  ACCOUNT_DELETION_REAUTHENTICATION_PATH,
  readsAsReauthenticationReturn,
  resolveAccountDeletionOutcome,
  resolveDeleteAccountDescription,
  resolveReauthenticationErrorMessage,
  resolveReauthenticationMethods,
};
export type { AccountDeletionOutcome, DeleteAccountStep, ReauthenticationMethod };
