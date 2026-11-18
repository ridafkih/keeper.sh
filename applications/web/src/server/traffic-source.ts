const WEB_PROTOCOLS = new Set(["http:", "https:"]);
const UTM_PARAMETER_PREFIX = "utm_";
const GOOGLE_CLICK_ID_PARAMETER = "gclid";

interface TrafficSource {
  referrerOrigin: string | null;
  hasUtmParameters: boolean;
  hasGoogleClickId: boolean;
}

function resolveReferrerOrigin(referrer: string | null): string | null {
  if (!referrer || !URL.canParse(referrer)) return null;
  const referrerUrl = new URL(referrer);
  if (!WEB_PROTOCOLS.has(referrerUrl.protocol)) return null;
  return referrerUrl.origin;
}

function hasUtmParameters(searchParams: URLSearchParams): boolean {
  return [...searchParams.keys()].some((key) => key.toLowerCase().startsWith(UTM_PARAMETER_PREFIX));
}

function resolveTrafficSource(request: Request, requestUrl: URL): TrafficSource {
  return {
    referrerOrigin: resolveReferrerOrigin(request.headers.get("referer")),
    hasUtmParameters: hasUtmParameters(requestUrl.searchParams),
    hasGoogleClickId: requestUrl.searchParams.has(GOOGLE_CLICK_ID_PARAMETER),
  };
}

export { resolveTrafficSource };
export type { TrafficSource };
