import { useEffect } from "react";
import { track, ANALYTICS_EVENTS, reportSignupConversionBeforeNavigation } from "@/lib/analytics";
import { getPublicRuntimeConfig } from "@/lib/runtime-config";
import { consumeSignupMarker } from "@/lib/signup-marker";
import { buildCalendarConsentUrl } from "@/lib/sign-up-continuation";
import type { CalendarConsentProvider } from "@/lib/sign-up-continuation";

export function useOpenCalendarConsent(provider: CalendarConsentProvider) {
  useEffect(() => {
    const openConsent = () => {
      globalThis.location.replace(buildCalendarConsentUrl(provider, { forSignedInAccount: true }));
    };

    track(ANALYTICS_EVENTS.oauth_authorize_started, {
      oauth_after_sign_up: true,
      oauth_is_reconnect: false,
      provider_name: provider,
    });

    if (!consumeSignupMarker()) {
      openConsent();
      return;
    }

    track(ANALYTICS_EVENTS.signup_completed, { provider: "oauth" });
    reportSignupConversionBeforeNavigation(getPublicRuntimeConfig(), openConsent);
  }, [provider]);
}
