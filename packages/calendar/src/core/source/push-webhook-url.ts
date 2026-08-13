const GOOGLE_CALLBACK_PATH = "/api/webhook/google";
const OUTLOOK_CALLBACK_PATH = "/api/webhook/outlook";

const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u;
const NO_OCTET = -1;
const PRIVATE_FIRST_OCTETS = new Set([0, 10, 127]);
const CARRIER_GRADE_NAT_FIRST_OCTET = 100;
const CARRIER_GRADE_NAT_MIN = 64;
const CARRIER_GRADE_NAT_MAX = 127;
const LINK_LOCAL_FIRST_OCTET = 169;
const LINK_LOCAL_SECOND_OCTET = 254;
const PRIVATE_172_FIRST_OCTET = 172;
const PRIVATE_172_MIN = 16;
const PRIVATE_172_MAX = 31;
const PRIVATE_192_FIRST_OCTET = 192;
const PRIVATE_192_SECOND_OCTET = 168;
const IPV6_UNREACHABLE_PREFIXES = ["fc", "fd", "fe80:"];

interface WebhookConfig {
  googleCallbackUrl: string;
  outlookCallbackUrl: string;
}

const isUnreachableIpv4 = (hostname: string): boolean => {
  const match = IPV4_PATTERN.exec(hostname);
  if (!match) {
    return false;
  }

  const [first = NO_OCTET, second = NO_OCTET] = match.slice(1, 5).map(Number);

  return PRIVATE_FIRST_OCTETS.has(first)
    || (first === CARRIER_GRADE_NAT_FIRST_OCTET
      && second >= CARRIER_GRADE_NAT_MIN
      && second <= CARRIER_GRADE_NAT_MAX)
    || (first === LINK_LOCAL_FIRST_OCTET && second === LINK_LOCAL_SECOND_OCTET)
    || (first === PRIVATE_172_FIRST_OCTET
      && second >= PRIVATE_172_MIN
      && second <= PRIVATE_172_MAX)
    || (first === PRIVATE_192_FIRST_OCTET && second === PRIVATE_192_SECOND_OCTET);
};

const isUnreachableIpv6 = (normalized: string): boolean => {
  if (!normalized.includes(":")) {
    return false;
  }

  return normalized === "::1"
    || IPV6_UNREACHABLE_PREFIXES.some((prefix) => normalized.startsWith(prefix));
};

const isUnreachableHostname = (hostname: string): boolean => {
  const normalized = hostname.toLowerCase().replaceAll(/^\[|\]$/gu, "");

  if (
    normalized === "localhost"
    || normalized.endsWith(".localhost")
    || normalized.endsWith(".local")
  ) {
    return true;
  }

  return isUnreachableIpv6(normalized) || isUnreachableIpv4(normalized);
};

const parsePublicUrl = (rawUrl: string): URL => {
  try {
    return new URL(rawUrl);
  } catch (error) {
    throw new Error(
      `WEBHOOK_PUBLIC_URL is not a valid url: ${rawUrl}`,
      { cause: error },
    );
  }
};

const resolveWebhookConfig = (rawUrl: string | undefined): WebhookConfig | null => {
  if (!rawUrl) {
    return null;
  }

  const url = parsePublicUrl(rawUrl);

  if (url.protocol !== "https:") {
    throw new Error(
      `WEBHOOK_PUBLIC_URL must use https so calendar providers can reach it: ${rawUrl}`,
    );
  }
  if (url.search.length > 0 || url.hash.length > 0) {
    throw new Error(
      `WEBHOOK_PUBLIC_URL must not carry a query string or fragment: ${rawUrl}`,
    );
  }
  if (url.pathname !== "" && url.pathname !== "/") {
    throw new Error(
      `WEBHOOK_PUBLIC_URL must be an origin without a path, received the path ${url.pathname}: ${rawUrl}`,
    );
  }
  if (isUnreachableHostname(url.hostname)) {
    throw new Error(
      `WEBHOOK_PUBLIC_URL must be publicly reachable, not ${url.hostname}`,
    );
  }

  return {
    googleCallbackUrl: new URL(GOOGLE_CALLBACK_PATH, url).toString(),
    outlookCallbackUrl: new URL(OUTLOOK_CALLBACK_PATH, url).toString(),
  };
};

export { resolveWebhookConfig };
export type { WebhookConfig };
