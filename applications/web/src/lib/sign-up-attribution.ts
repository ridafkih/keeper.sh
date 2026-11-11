import {
  MAX_LANDING_PATH_LENGTH,
  MAX_UTM_VALUE_LENGTH,
  parseSignUpAttribution,
} from "@keeper.sh/data-schemas/client";
import type { SignUpAttribution } from "@keeper.sh/data-schemas/client";

const SIGN_UP_ATTRIBUTION_STORAGE_KEY = "keeper.sign_up_attribution";

const UTM_PARAMETERS = {
  utmCampaign: "utm_campaign",
  utmMedium: "utm_medium",
  utmSource: "utm_source",
} as const;

type AttributionStorage = Pick<Storage, "getItem" | "setItem">;

interface FirstVisit {
  href: string;
  referrer: string;
}

const resolveExternalReferrerOrigin = (referrer: string, siteOrigin: string): string | null => {
  if (!URL.canParse(referrer)) return null;
  const { origin } = new URL(referrer);
  if (origin === siteOrigin) return null;
  return origin;
};

const readUtmValue = (searchParams: URLSearchParams, name: string): string | null =>
  searchParams.get(name)?.slice(0, MAX_UTM_VALUE_LENGTH) ?? null;

const buildSignUpAttribution = ({ href, referrer }: FirstVisit): SignUpAttribution | null => {
  const url = new URL(href);
  return parseSignUpAttribution({
    landingPath: url.pathname.slice(0, MAX_LANDING_PATH_LENGTH),
    referrerOrigin: resolveExternalReferrerOrigin(referrer, url.origin),
    utmCampaign: readUtmValue(url.searchParams, UTM_PARAMETERS.utmCampaign),
    utmMedium: readUtmValue(url.searchParams, UTM_PARAMETERS.utmMedium),
    utmSource: readUtmValue(url.searchParams, UTM_PARAMETERS.utmSource),
  });
};

const parseStoredAttribution = (stored: string): SignUpAttribution | null => {
  try {
    return parseSignUpAttribution(JSON.parse(stored));
  } catch {
    return null;
  }
};

const rememberFirstVisit = (storage: AttributionStorage, visit: FirstVisit): void => {
  if (storage.getItem(SIGN_UP_ATTRIBUTION_STORAGE_KEY) !== null) return;
  const attribution = buildSignUpAttribution(visit);
  storage.setItem(SIGN_UP_ATTRIBUTION_STORAGE_KEY, JSON.stringify(attribution ?? {}));
};

const readRememberedAttribution = (storage: AttributionStorage): SignUpAttribution | null => {
  const stored = storage.getItem(SIGN_UP_ATTRIBUTION_STORAGE_KEY);
  if (stored === null) return null;
  return parseStoredAttribution(stored);
};

const resolveSessionStorage = (): AttributionStorage | null => {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
};

const rememberThisVisit = (): void => {
  const storage = resolveSessionStorage();
  if (!storage) return;
  try {
    rememberFirstVisit(storage, { href: globalThis.location.href, referrer: document.referrer });
  } catch {
    return;
  }
};

const readSignUpAttribution = (): SignUpAttribution | null => {
  const storage = resolveSessionStorage();
  if (!storage) return null;
  try {
    return readRememberedAttribution(storage);
  } catch {
    return null;
  }
};

const withSignUpAttribution = <TBody extends object>(body: TBody): TBody & { attribution?: SignUpAttribution } => {
  const attribution = readSignUpAttribution();
  if (!attribution) return body;
  return { ...body, attribution };
};

export {
  SIGN_UP_ATTRIBUTION_STORAGE_KEY,
  buildSignUpAttribution,
  readRememberedAttribution,
  readSignUpAttribution,
  rememberFirstVisit,
  rememberThisVisit,
  withSignUpAttribution,
};
export type { AttributionStorage, FirstVisit };
