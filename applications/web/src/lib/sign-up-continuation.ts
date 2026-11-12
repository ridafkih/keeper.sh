import type { ConnectReturnTo } from "./connect-return";
import { withSignupMarker } from "./signup-marker";

type SignUpProvider = "google" | "microsoft" | "oidc";
type CalendarConsentProvider = "google" | "outlook";

const DEFAULT_POST_SIGN_UP_PATH = "/dashboard";
const CONSENT_CONTINUATION = "consent";

const CALENDAR_CONSENT_PROVIDERS: Partial<Record<SignUpProvider, CalendarConsentProvider>> = {
  google: "google",
  microsoft: "outlook",
};

const resolveNewUserCallbackURL = (
  provider: SignUpProvider,
  callbackURL: string,
  origin: string,
): string => {
  const consentProvider = CALENDAR_CONSENT_PROVIDERS[provider];
  if (!consentProvider || callbackURL !== DEFAULT_POST_SIGN_UP_PATH) {
    return withSignupMarker(callbackURL, origin);
  }
  return withSignupMarker(`/dashboard/connect/${consentProvider}?continue=${CONSENT_CONTINUATION}`, origin);
};

const isConsentContinuation = (value: unknown): value is typeof CONSENT_CONTINUATION =>
  value === CONSENT_CONTINUATION;

const buildCalendarConsentUrl = (
  provider: CalendarConsentProvider,
  { forSignedInAccount, returnTo }: { forSignedInAccount: boolean; returnTo?: ConnectReturnTo },
): string => {
  const search = new URLSearchParams({ provider });
  if (forSignedInAccount) search.set("account", "sign-in");
  if (returnTo) search.set("returnTo", returnTo);
  return `/api/sources/authorize?${search.toString()}`;
};

export { buildCalendarConsentUrl, isConsentContinuation, resolveNewUserCallbackURL };
export type { CalendarConsentProvider, SignUpProvider };
