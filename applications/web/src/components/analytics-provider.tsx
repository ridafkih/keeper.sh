"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import Script from "next/script";
import { useSyncExternalStore } from "react";
import { hasAnalyticsConsent, track } from "@/lib/analytics";

const { NEXT_PUBLIC_GOOGLE_ADS_ID } = process.env;

const subscribe = (callback: () => void): (() => void) => {
  window.addEventListener("storage", callback);
  return (): void => window.removeEventListener("storage", callback);
};

interface AnalyticsProviderProps {
  token: string;
  gdprApplies: boolean;
}

import type { ReactNode } from "react";

export const AnalyticsProvider = ({ token, gdprApplies }: AnalyticsProviderProps): ReactNode => {
  const pathname = usePathname();
  const hasConsent = useSyncExternalStore(
    subscribe,
    (): boolean => hasAnalyticsConsent(),
    (): boolean => false,
  );

  const canTrack = !gdprApplies || hasConsent;

  const getConsentState = (): "granted" | "denied" => {
    if (canTrack) {
      return "granted";
    }
    return "denied";
  };

  const consentState = getConsentState();

  const getScriptKey = (): string => {
    if (canTrack) {
      return "persist";
    }
    return "no-persist";
  };

  const scriptKey = getScriptKey();

  useEffect(() => {
    track("page_view", { path: pathname });
  }, [pathname]);

  return (
    <>
      <Script
        key={scriptKey}
        src="https://cdn.visitors.now/v.js"
        data-token={token}
        {...(canTrack && { "data-persist": true })}
      />
      {NEXT_PUBLIC_GOOGLE_ADS_ID && (
        <>
          <Script id="google-consent" strategy="beforeInteractive">
            {`
              window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              gtag('consent', 'default', {
                'ad_storage': '${consentState}',
                'ad_user_data': '${consentState}',
                'ad_personalization': '${consentState}',
                'analytics_storage': '${consentState}',
                'wait_for_update': 500
              });
            `}
          </Script>
          <Script
            src={`https://www.googletagmanager.com/gtag/js?id=${NEXT_PUBLIC_GOOGLE_ADS_ID}`}
            strategy="afterInteractive"
          />
          <Script id="google-ads" strategy="afterInteractive">
            {`
              window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              gtag('js', new Date());
              gtag('config', '${NEXT_PUBLIC_GOOGLE_ADS_ID}');
            `}
          </Script>
        </>
      )}
    </>
  );
};
