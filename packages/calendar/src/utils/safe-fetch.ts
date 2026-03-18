import { resolve4, resolve6 } from "node:dns/promises";
import ipaddr from "ipaddr.js";

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);
const MAX_REDIRECTS = 10;
const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);

interface SafeFetchOptions {
  blockPrivateResolution?: boolean;
  allowedPrivateHosts?: Set<string>;
}

class UrlSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UrlSafetyError";
  }
}

type SafeFetch = (input: string | Request | URL, init?: RequestInit) => Promise<Response>;

const normalizeToIPv4 = (parsed: ipaddr.IPv4 | ipaddr.IPv6): ipaddr.IPv4 | ipaddr.IPv6 => {
  if (parsed.kind() === "ipv6" && "isIPv4MappedAddress" in parsed && parsed.isIPv4MappedAddress()) {
    return parsed.toIPv4Address();
  }
  return parsed;
};

const isUnicastAddress = (address: string): boolean => {
  try {
    const parsed = normalizeToIPv4(ipaddr.parse(address));
    return parsed.range() === "unicast";
  } catch {
    return false;
  }
};

const assertUnicastAddress = (address: string, message: string): void => {
  if (!isUnicastAddress(address)) {
    throw new UrlSafetyError(message);
  }
};

const resolveAllAddresses = async (hostname: string): Promise<string[]> => {
  const results = await Promise.allSettled([resolve4(hostname), resolve6(hostname)]);

  const addresses = results.flatMap((result) => {
    if (result.status === "fulfilled") {
      return result.value;
    }
    return [];
  });

  if (addresses.length === 0) {
    throw new UrlSafetyError("The provided URL could not be resolved to any IP address.");
  }

  return addresses;
};

const stripBrackets = (hostname: string): string => hostname.replace(/^\[/, "").replace(/\]$/, "");

const validateProtocol = (protocol: string): void => {
  if (!ALLOWED_PROTOCOLS.has(protocol)) {
    throw new UrlSafetyError(
      `URL scheme "${protocol.replace(":", "")}" is not allowed. Only HTTP and HTTPS are supported.`,
    );
  }
};

const validateHostResolution = async (host: string, hostname: string, options: SafeFetchOptions): Promise<void> => {
  if (options.allowedPrivateHosts?.has(host)) {
    return;
  }

  if (ipaddr.isValid(hostname)) {
    assertUnicastAddress(hostname, "The provided URL points to a private or reserved network address.");
    return;
  }

  const addresses = await resolveAllAddresses(hostname);

  for (const address of addresses) {
    assertUnicastAddress(address, "The provided URL resolves to a private or reserved network address.");
  }
};

const validateUrlSafety = async (url: string, options?: SafeFetchOptions): Promise<void> => {
  const parsed = new URL(url);
  validateProtocol(parsed.protocol);

  if (!options?.blockPrivateResolution) {
    return;
  }

  await validateHostResolution(parsed.host, stripBrackets(parsed.hostname), options);
};

const resolveRedirectUrl = (response: Response, originalUrl: string): string | null => {
  const location = response.headers.get("location");
  if (!location) {
    return null;
  }

  try {
    return new URL(location, originalUrl).href;
  } catch {
    return null;
  }
};

const isCrossOrigin = (current: string, next: string): boolean => new URL(current).origin !== new URL(next).origin;

const toHeaderRecord = (headers: RequestInit["headers"]): Record<string, string> => {
  const normalized = new Headers(headers);
  const record: Record<string, string> = {};

  for (const [key, value] of normalized.entries()) {
    record[key] = value;
  }

  return record;
};

const withoutAuthorization = (headers: Record<string, string>): Record<string, string> => Object.fromEntries(Object.entries(headers).filter(([key]) => key.toLowerCase() !== "authorization"));

const isRedirect = (response: Response): boolean => REDIRECT_STATUS_CODES.has(response.status);

const getHeadersForRedirect = (
  headers: Record<string, string>,
  currentUrl: string,
  redirectUrl: string,
): Record<string, string> => {
  if (isCrossOrigin(currentUrl, redirectUrl)) {
    return withoutAuthorization(headers);
  }
  return headers;
};

const followRedirects = async (
  initialUrl: string,
  initialResponse: Response,
  init: RequestInit | undefined,
  options: SafeFetchOptions | undefined,
): Promise<Response> => {
  const headers = toHeaderRecord(init?.headers);
  let currentUrl = initialUrl;
  let currentResponse = initialResponse;
  let currentHeaders = headers;

  for (let count = 0; count < MAX_REDIRECTS; count++) {
    const redirectUrl = resolveRedirectUrl(currentResponse, currentUrl);
    if (!redirectUrl) {
      return currentResponse;
    }

    await validateUrlSafety(redirectUrl, options);

    currentHeaders = getHeadersForRedirect(currentHeaders, currentUrl, redirectUrl);
    currentUrl = redirectUrl;

    currentResponse = await globalThis.fetch(currentUrl, {
      ...init,
      headers: currentHeaders,
      redirect: "manual",
    });

    if (!isRedirect(currentResponse)) {
      return currentResponse;
    }
  }

  throw new UrlSafetyError(`Too many redirects (exceeded ${MAX_REDIRECTS}).`);
};

const extractUrl = (input: string | Request | URL): string => {
  if (input instanceof Request) {
    return input.url;
  }
  return input.toString();
};

const createSafeFetch = (options?: SafeFetchOptions): SafeFetch => async (input, init) => {
    const url = extractUrl(input);
    await validateUrlSafety(url, options);

    const response = await globalThis.fetch(input, {
      ...init,
      redirect: "manual",
    });

    if (!isRedirect(response)) {
      return response;
    }

    return followRedirects(url, response, init, options);
  };

export { createSafeFetch, UrlSafetyError, validateUrlSafety };
export type { SafeFetchOptions };
