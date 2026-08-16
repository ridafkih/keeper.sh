import type { PublicRuntimeConfig } from "./runtime-config";

const CONSENT_COOKIE = "keeper.analytics_consent";
const CONSENT_MAX_AGE = 60 * 60 * 24 * 182;

function resolveConsentState(granted: boolean): "granted" | "denied" {
  if (granted) return "granted";
  return "denied";
}

function readCookieSource(cookieHeader?: string): string {
  if (cookieHeader !== undefined) return cookieHeader;
  if (typeof document === "undefined") return "";
  return document.cookie;
}

function readConsentValue(cookieHeader?: string): string | null {
  const source = readCookieSource(cookieHeader);
  const prefix = `${CONSENT_COOKIE}=`;
  const match = source
    .split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(prefix));

  if (!match) return null;
  return match.slice(prefix.length);
}

const updateGoogleConsent = (granted: boolean): void => {
  const state = resolveConsentState(granted);
  globalThis.gtag?.("consent", "update", {
    ad_personalization: state,
    ad_storage: state,
    ad_user_data: state,
    analytics_storage: state,
  });
};

const hasAnalyticsConsent = (cookieHeader?: string): boolean =>
  readConsentValue(cookieHeader) === "granted";

const hasConsentChoice = (cookieHeader?: string): boolean => {
  const value = readConsentValue(cookieHeader);
  return value === "granted" || value === "denied";
};

function resolveEffectiveConsent(gdprApplies: boolean, cookieHeader?: string): boolean {
  const value = readConsentValue(cookieHeader);
  if (value === "granted") return true;
  if (value === "denied") return false;
  return !gdprApplies;
}

const subscribeToConsentChanges = (listener: () => void): (() => void) => {
  globalThis.addEventListener("storage", listener);
  return () => globalThis.removeEventListener("storage", listener);
};

const setAnalyticsConsent = (granted: boolean): void => {
  const state = resolveConsentState(granted);
  document.cookie = `${CONSENT_COOKIE}=${state}; path=/; max-age=${CONSENT_MAX_AGE}; samesite=lax`;
  updateGoogleConsent(granted);
  globalThis.dispatchEvent(new StorageEvent("storage", { key: CONSENT_COOKIE }));
};

export const ANALYTICS_EVENTS = {
  signup_completed: "signup_completed",
  login_completed: "login_completed",
  password_reset_requested: "password_reset_requested",
  password_reset_completed: "password_reset_completed",
  logout: "logout",
  calendar_connect_started: "calendar_connect_started",
  calendar_renamed: "calendar_renamed",
  destination_toggled: "destination_toggled",
  write_back_mode_changed: "write_back_mode_changed",
  calendar_setting_toggled: "calendar_setting_toggled",
  calendar_account_deleted: "calendar_account_deleted",
  calendars_refreshed: "calendars_refreshed",
  setup_step_completed: "setup_step_completed",
  setup_skipped: "setup_skipped",
  setup_completed: "setup_completed",
  password_changed: "password_changed",
  passkey_created: "passkey_created",
  passkey_deleted: "passkey_deleted",
  api_token_created: "api_token_created",
  api_token_deleted: "api_token_deleted",
  analytics_consent_changed: "analytics_consent_changed",
  account_deleted: "account_deleted",
  upgrade_billing_toggled: "upgrade_billing_toggled",
  upgrade_started: "upgrade_started",
  plan_managed: "plan_managed",
  feedback_submitted: "feedback_submitted",
  report_submitted: "report_submitted",
  ical_feed_created: "ical_feed_created",
  ical_feed_deleted: "ical_feed_deleted",
  ical_link_copied: "ical_link_copied",
  ical_setting_toggled: "ical_setting_toggled",
  ical_source_toggled: "ical_source_toggled",
  oauth_consent_granted: "oauth_consent_granted",
  oauth_consent_denied: "oauth_consent_denied",
  marketing_cta_clicked: "marketing_cta_clicked",
} satisfies Record<string, string>;

type EventProperties = Record<string, string | number | boolean>;

const track = (event: string, properties?: EventProperties): void => {
  globalThis.visitors?.track(event, properties);
};

interface IdentifyProps {
  id: string;
  email?: string;
  name?: string;
}

const identify = (
  user: IdentifyProps,
  options: { gdprApplies: boolean },
): void => {
  if (options.gdprApplies && !hasAnalyticsConsent()) return;
  globalThis.visitors?.identify(user);
};

interface ConversionOptions {
  value?: number | null;
  currency?: string | null;
  transactionId?: string | null;
}

const buildConversionPayload = (
  sendTo: string,
  options?: ConversionOptions,
): Record<string, string | number> => ({
  send_to: sendTo,
  ...(typeof options?.value === "number" && { value: options.value }),
  ...(options?.currency && { currency: options.currency }),
  ...(options?.transactionId && { transaction_id: options.transactionId }),
});

const reportConversion = (
  googleAdsId: string | null,
  conversionLabel: string | null,
  options?: ConversionOptions,
): void => {
  if (!googleAdsId || !conversionLabel) return;
  globalThis.gtag?.(
    "event",
    "conversion",
    buildConversionPayload(`${googleAdsId}/${conversionLabel}`, options),
  );
};

const reportPurchaseConversion = (
  runtimeConfig: PublicRuntimeConfig,
  options?: ConversionOptions,
): void => {
  reportConversion(runtimeConfig.googleAdsId, runtimeConfig.googleAdsConversionLabel, options);
};

const reportSignupConversion = (runtimeConfig: PublicRuntimeConfig): void => {
  reportConversion(runtimeConfig.googleAdsId, runtimeConfig.googleAdsSignupConversionLabel);
};

const reportGooglePageView = (googleAdsId: string | null, path: string): void => {
  if (!googleAdsId) return;
  globalThis.gtag?.("event", "page_view", { page_path: path, send_to: googleAdsId });
};

declare global {
  var visitors:
    | {
        identify: (props: IdentifyProps) => void;
        track: (event: string, properties?: EventProperties) => void;
      }
    | undefined;
  var gtag: ((...args: unknown[]) => void) | undefined;
}

export {
  CONSENT_COOKIE,
  updateGoogleConsent,
  hasAnalyticsConsent,
  hasConsentChoice,
  identify,
  reportGooglePageView,
  reportPurchaseConversion,
  reportSignupConversion,
  resolveEffectiveConsent,
  setAnalyticsConsent,
  subscribeToConsentChanges,
  track,
};
