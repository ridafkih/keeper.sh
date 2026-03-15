import { getPublicRuntimeConfig, type PublicRuntimeConfig } from "./runtime-config";

const CONSENT_KEY = "analytics_consent";

const resolveAnalyticsConfig = (
  runtimeConfig?: PublicRuntimeConfig,
): PublicRuntimeConfig => runtimeConfig ?? getPublicRuntimeConfig();

const getConsentState = (granted: boolean): "granted" | "denied" =>
  granted ? "granted" : "denied";

const updateGoogleConsent = (granted: boolean): void => {
  const state = getConsentState(granted);
  globalThis.gtag?.("consent", "update", {
    ad_personalization: state,
    ad_storage: state,
    ad_user_data: state,
    analytics_storage: state,
  });
};

const hasAnalyticsConsent = (): boolean => {
  if (typeof globalThis === "undefined") return false;
  return localStorage.getItem(CONSENT_KEY) === "granted";
};

const hasConsentChoice = (): boolean => {
  if (typeof globalThis === "undefined") return false;
  const value = localStorage.getItem(CONSENT_KEY);
  return value === "granted" || value === "denied";
};

const setAnalyticsConsent = (granted: boolean): void => {
  localStorage.setItem(CONSENT_KEY, getConsentState(granted));
  updateGoogleConsent(granted);
  globalThis.dispatchEvent(new StorageEvent("storage", { key: CONSENT_KEY }));
};

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
  value: number | null;
  currency: string | null;
  transactionId: string | null;
}

const reportPurchaseConversion = (options?: ConversionOptions): void => {
  const { googleAdsConversionLabel, googleAdsId } = resolveAnalyticsConfig();
  if (!googleAdsId || !googleAdsConversionLabel) return;
  globalThis.gtag?.("event", "conversion", {
    send_to: `${googleAdsId}/${googleAdsConversionLabel}`,
    ...options,
  });
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
  hasAnalyticsConsent,
  hasConsentChoice,
  identify,
  reportPurchaseConversion,
  resolveAnalyticsConfig,
  setAnalyticsConsent,
  track,
};
