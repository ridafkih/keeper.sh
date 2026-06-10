import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { useLocation } from "@tanstack/react-router";
import type { PublicRuntimeConfig } from "@/lib/runtime-config";
import {
  identify,
  resolveEffectiveConsent,
  track,
} from "@/lib/analytics";
import { useSession } from "@/hooks/use-session";

const subscribe = (callback: () => void): (() => void) => {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
};

const getServerSnapshot = (): boolean => false;

function resolveConsentLabel(hasConsent: boolean): "granted" | "denied" {
  if (hasConsent) return "granted";
  return "denied";
}

function AnalyticsScripts({ runtimeConfig }: { runtimeConfig: PublicRuntimeConfig }) {
  const { gdprApplies, googleAdsId, visitorsNowToken } = runtimeConfig;
  const getSnapshot = useCallback(
    () => resolveEffectiveConsent(gdprApplies),
    [gdprApplies],
  );
  const hasConsent = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const location = useLocation();
  const consentState = resolveConsentLabel(hasConsent);
  const { user } = useSession();
  const identifiedUserId = useRef<string | null>(null);

  useEffect(() => {
    track("page_view", { path: location.pathname });
  }, [location.pathname]);

  useEffect(() => {
    if (!user) return;
    if (identifiedUserId.current === user.id) return;

    identifiedUserId.current = user.id;
    identify({ id: user.id, email: user.email, name: user.name }, { gdprApplies });
  }, [user, gdprApplies]);

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
