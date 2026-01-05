const CONSENT_KEY = "analytics_consent";

const getConsentState = (granted: boolean): "granted" | "denied" => {
  if (granted) {
    return "granted";
  }
  return "denied";
};

const updateGoogleConsent = (granted: boolean): void => {
  const state = getConsentState(granted);
  globalThis.gtag?.("consent", "update", {
    ad_personalization: state,
    ad_storage: state,
    ad_user_data: state,
    analytics_storage: state,
  });
};

const setAnalyticsConsent = (granted: boolean): void => {
  const consentValue = getConsentState(granted);
  localStorage.setItem(CONSENT_KEY, consentValue);
  updateGoogleConsent(granted);
  globalThis.dispatchEvent(new StorageEvent("storage", { key: CONSENT_KEY }));
};

type EventProperties = Record<string, string | number | boolean>;

const track = (event: string, properties?: EventProperties): void => {
  globalThis.visitors?.track(event, properties);
};

const hasAnalyticsConsent = (): boolean => {
  if (typeof globalThis === "undefined") {
    return false;
  }
  return localStorage.getItem(CONSENT_KEY) === "granted";
};

const hasConsentChoice = (): boolean => {
  if (typeof globalThis === "undefined") {
    return false;
  }
  const value = localStorage.getItem(CONSENT_KEY);
  return value === "granted" || value === "denied";
};

interface IdentifyProps {
  id: string;
  email?: string;
  name?: string;
}

const identify = (user: IdentifyProps, options: { gdprApplies: boolean }): void => {
  if (options.gdprApplies && !hasAnalyticsConsent()) {
    return;
  }
  globalThis.visitors?.identify(user);
};

interface ConversionOptions {
  value: number | null;
  currency: string | null;
  transactionId: string | null;
}

const { NEXT_PUBLIC_GOOGLE_ADS_ID, NEXT_PUBLIC_GOOGLE_ADS_CONVERSION_LABEL } = process.env;

const reportPurchaseConversion = (options?: ConversionOptions): void => {
  if (!NEXT_PUBLIC_GOOGLE_ADS_ID || !NEXT_PUBLIC_GOOGLE_ADS_CONVERSION_LABEL) {
    return;
  }
  globalThis.gtag?.("event", "conversion", {
    send_to: `${NEXT_PUBLIC_GOOGLE_ADS_ID}/${NEXT_PUBLIC_GOOGLE_ADS_CONVERSION_LABEL}`,
    ...options,
  });
};

declare global {
  // eslint-disable-next-line no-var -- globalThis augmentation requires var
  var visitors:
    | {
        identify: (props: IdentifyProps) => void;
        track: (event: string, properties?: EventProperties) => void;
      }
    | undefined;
  // eslint-disable-next-line no-var -- globalThis augmentation requires var
  var gtag: ((...args: unknown[]) => void) | undefined;
}

export {
  setAnalyticsConsent,
  track,
  hasAnalyticsConsent,
  hasConsentChoice,
  identify,
  reportPurchaseConversion,
};

export type { IdentifyProps };
