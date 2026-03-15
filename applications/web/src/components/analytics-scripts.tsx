import { useEffect, useSyncExternalStore } from "react";
import { useLocation } from "@tanstack/react-router";
import type { PublicRuntimeConfig } from "@/lib/runtime-config";
import {
  hasAnalyticsConsent,
  resolveAnalyticsConfig,
  track,
} from "@/lib/analytics";

const subscribe = (callback: () => void): (() => void) => {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
};

const getSnapshot = (): boolean => hasAnalyticsConsent();
const getServerSnapshot = (): boolean => false;

function AnalyticsScripts({ runtimeConfig }: { runtimeConfig: PublicRuntimeConfig }) {
  const hasConsent = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const location = useLocation();
  const consentState = hasConsent ? "granted" : "denied";
  const { googleAdsId, visitorsNowToken } = resolveAnalyticsConfig(runtimeConfig);

  useEffect(() => {
    track("page_view", { path: location.pathname });
  }, [location.pathname]);

  return (
    <>
      {visitorsNowToken && (
        <script
          defer
          src="https://cdn.visitors.now/v.js"
          data-token={visitorsNowToken}
          {...(hasConsent && { "data-persist": true })}
        />
      )}
      {googleAdsId && (
        <>
          <script
            defer
            dangerouslySetInnerHTML={{
              __html: `
                window.dataLayer = window.dataLayer || [];
                function gtag(){dataLayer.push(arguments);}
                gtag('consent', 'default', {
                  'ad_storage': '${consentState}',
                  'ad_user_data': '${consentState}',
                  'ad_personalization': '${consentState}',
                  'analytics_storage': '${consentState}',
                  'wait_for_update': 500
                });
              `,
            }}
          />
          <script
            async
            src={`https://www.googletagmanager.com/gtag/js?id=${googleAdsId}`}
          />
          <script
            dangerouslySetInnerHTML={{
              __html: `
                window.dataLayer = window.dataLayer || [];
                function gtag(){dataLayer.push(arguments);}
                gtag('js', new Date());
                gtag('config', '${googleAdsId}');
              `,
            }}
          />
        </>
      )}
    </>
  );
}

export { AnalyticsScripts };
