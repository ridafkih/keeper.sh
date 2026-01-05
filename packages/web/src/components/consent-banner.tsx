import { Suspense, cache, use } from "react";
import type { ReactNode } from "react";
import { headers } from "next/headers";
import { CookieConsent } from "@/components/cookie-consent";
import { GDPR_COUNTRIES } from "@/config/analytics";

const getCountry = cache(
  (): Promise<string> =>
    headers().then((headers): string => headers.get("x-vercel-ip-country") ?? ""),
);

const ConsentBannerInner = (): ReactNode => {
  const country = use(getCountry());
  const requiresConsent = GDPR_COUNTRIES.has(country);

  if (!requiresConsent) {
    return;
  }

  return <CookieConsent />;
};

export const ConsentBanner = (): ReactNode => (
  <Suspense>
    <ConsentBannerInner />
  </Suspense>
);
