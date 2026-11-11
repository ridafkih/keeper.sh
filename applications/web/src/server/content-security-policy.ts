import type { PublicRuntimeConfig } from "@/lib/runtime-config";
import { mergeContentSecurityPolicySources } from "./content-security-policy-sources";
import { resolveGoogleTagSources } from "./google-tag-csp";
import { resolveVisitorsNowSources } from "./visitors-now-csp";

const formatDirective = (name: string, sources: readonly string[]): string =>
  [name, ...sources].join(" ");

const buildContentSecurityPolicy = (runtimeConfig: PublicRuntimeConfig): string => {
  const thirdPartySources = mergeContentSecurityPolicySources([
    resolveGoogleTagSources(runtimeConfig),
    resolveVisitorsNowSources(runtimeConfig),
  ]);

  return [
    "default-src 'self'",
    formatDirective("script-src", ["'self'", "'unsafe-inline'", ...thirdPartySources.script]),
    "style-src 'self' 'unsafe-inline'",
    formatDirective("img-src", ["'self'", "data:", ...thirdPartySources.img]),
    "font-src 'self'",
    formatDirective("connect-src", ["'self'", ...thirdPartySources.connect]),
    formatDirective("frame-src", ["https://polar.sh", ...thirdPartySources.frame]),
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
};

export { buildContentSecurityPolicy };
