const MAX_LANDING_PATH_LENGTH = 200;
const MAX_REFERRER_ORIGIN_LENGTH = 200;
const MAX_UTM_VALUE_LENGTH = 100;

const LANDING_PATH_PATTERN = /^\/[A-Za-z0-9\-._~/%]*$/;
const UTM_VALUE_PATTERN = /^[A-Za-z0-9\-._~+%: /|]+$/;
const WEB_PROTOCOLS = new Set(["http:", "https:"]);

interface SignUpAttribution {
  landingPath?: string;
  referrerOrigin?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
}

const SIGN_UP_ATTRIBUTION_FIELDS = [
  "landingPath",
  "referrerOrigin",
  "utmSource",
  "utmMedium",
  "utmCampaign",
] as const satisfies readonly (keyof SignUpAttribution)[];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseLandingPath = (value: unknown): string | null => {
  if (typeof value !== "string" || value.length > MAX_LANDING_PATH_LENGTH) {
    return null;
  }
  if (!LANDING_PATH_PATTERN.test(value)) {
    return null;
  }
  return value;
};

const parseReferrerOrigin = (value: unknown): string | null => {
  if (typeof value !== "string" || value.length > MAX_REFERRER_ORIGIN_LENGTH) {
    return null;
  }
  if (!URL.canParse(value)) {
    return null;
  }
  const url = new URL(value);
  if (!WEB_PROTOCOLS.has(url.protocol) || url.origin !== value) {
    return null;
  }
  return url.origin;
};

const parseUtmValue = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_UTM_VALUE_LENGTH) {
    return null;
  }
  if (!UTM_VALUE_PATTERN.test(trimmed)) {
    return null;
  }
  return trimmed;
};

const FIELD_PARSERS: Record<keyof SignUpAttribution, (value: unknown) => string | null> = {
  landingPath: parseLandingPath,
  referrerOrigin: parseReferrerOrigin,
  utmCampaign: parseUtmValue,
  utmMedium: parseUtmValue,
  utmSource: parseUtmValue,
};

const parseSignUpAttribution = (value: unknown): SignUpAttribution | null => {
  if (!isRecord(value)) {
    return null;
  }

  const attribution: SignUpAttribution = {};
  for (const field of SIGN_UP_ATTRIBUTION_FIELDS) {
    const parsed = FIELD_PARSERS[field](value[field]);
    if (parsed !== null) {
      attribution[field] = parsed;
    }
  }

  if (Object.keys(attribution).length === 0) {
    return null;
  }
  return attribution;
};

export {
  MAX_LANDING_PATH_LENGTH,
  MAX_REFERRER_ORIGIN_LENGTH,
  MAX_UTM_VALUE_LENGTH,
  SIGN_UP_ATTRIBUTION_FIELDS,
  parseSignUpAttribution,
};
export type { SignUpAttribution };
