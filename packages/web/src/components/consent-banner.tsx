import { Suspense, use, cache } from "react";
import { headers } from "next/headers";
import { CookieConsent } from "@/components/cookie-consent";
import { GDPR_COUNTRIES } from "@/config/analytics";

const getCountry = cache(() =>
  headers().then((headers) => headers.get("x-vercel-ip-country") ?? ""),
);

const ConsentBannerInner = () => {
  const country = use(getCountry());
  const requiresConsent = GDPR_COUNTRIES.has(country);

  if (!requiresConsent) return null;

  return <CookieConsent />;
};

export const ConsentBanner = () => (
  <Suspense>
    <ConsentBannerInner />
  </Suspense>
);
