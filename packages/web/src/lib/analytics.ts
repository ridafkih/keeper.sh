const CONSENT_KEY = "analytics_consent";

export const setAnalyticsConsent = (granted: boolean) => {
  localStorage.setItem(CONSENT_KEY, granted ? "granted" : "denied");
  window.dispatchEvent(new StorageEvent("storage", { key: CONSENT_KEY }));
};

type EventProperties = Record<string, string | number | boolean>;

export const track = (event: string, properties?: EventProperties) => {
  window.visitors?.track(event, properties);
};

export const hasAnalyticsConsent = (): boolean => {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(CONSENT_KEY) === "granted";
};

export const hasConsentChoice = (): boolean => {
  if (typeof window === "undefined") return false;
  const value = localStorage.getItem(CONSENT_KEY);
  return value === "granted" || value === "denied";
};

export interface IdentifyProps {
  id: string;
  email?: string;
  name?: string;
}

export const identify = (
  user: IdentifyProps,
  options: { gdprApplies: boolean },
) => {
  if (options.gdprApplies && !hasAnalyticsConsent()) return;
  window.visitors?.identify(user);
};

declare global {
  interface Window {
    visitors?: {
      identify: (props: IdentifyProps) => void;
      track: (event: string, properties?: EventProperties) => void;
    };
  }
}
