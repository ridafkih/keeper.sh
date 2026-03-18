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

const isUnicastAddress = (address: string): boolean => {
  try {
    const parsed = ipaddr.parse(address);

    if (parsed.kind() === "ipv6" && "isIPv4MappedAddress" in parsed) {
      if (parsed.isIPv4MappedAddress()) {
        return parsed.toIPv4Address().range() === "unicast";
      }
    }

    return parsed.range() === "unicast";
  } catch {
    return false;
  }
};

const isHostAllowed = (host: string, allowedPrivateHosts: Set<string> | undefined): boolean => {
  if (!allowedPrivateHosts) {
    return false;
  }

  return allowedPrivateHosts.has(host);
};

const validateUrlSafety = async (url: string, options?: SafeFetchOptions): Promise<void> => {
  const parsed = new URL(url);

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new UrlSafetyError(
      `URL scheme "${parsed.protocol.replace(":", "")}" is not allowed. Only HTTP and HTTPS are supported.`,
    );
  }

  if (!options?.blockPrivateResolution) {
    return;
  }

  const host = parsed.host;
  const hostname = parsed.hostname.replace(/^\[/, "").replace(/\]$/, "");

  if (isHostAllowed(host, options.allowedPrivateHosts)) {
    return;
  }

  if (ipaddr.isValid(hostname)) {
    if (!isUnicastAddress(hostname)) {
      throw new UrlSafetyError(
        "The provided URL points to a private or reserved network address.",
      );
    }
    return;
  }

  const resolvedAddresses: string[] = [];

  try {
    const ipv4Addresses = await resolve4(hostname);
    resolvedAddresses.push(...ipv4Addresses);
  } catch {
    // hostname may not have A records
  }

  try {
    const ipv6Addresses = await resolve6(hostname);
    resolvedAddresses.push(...ipv6Addresses);
  } catch {
    // hostname may not have AAAA records
  }

  if (resolvedAddresses.length === 0) {
    throw new UrlSafetyError(
      "The provided URL could not be resolved to any IP address.",
    );
  }

  for (const address of resolvedAddresses) {
    if (!isUnicastAddress(address)) {
      throw new UrlSafetyError(
        "The provided URL resolves to a private or reserved network address.",
      );
    }
  }
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

const isCrossOrigin = (urlA: string, urlB: string): boolean => {
  const originA = new URL(urlA).origin;
  const originB = new URL(urlB).origin;
  return originA !== originB;
};

const stripAuthorizationHeader = (
  headers: Record<string, string>,
): Record<string, string> => {
  const filtered: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== "authorization") {
      filtered[key] = value;
    }
  }
  return filtered;
};

type SafeFetch = (input: string | Request | URL, init?: RequestInit) => Promise<Response>;

const extractHeaders = (headers: RequestInit["headers"] | undefined): Record<string, string> => {
  const result: Record<string, string> = {};

  if (!headers) {
    return result;
  }

  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      result[key] = value;
    });
    return result;
  }

  if (Array.isArray(headers)) {
    for (const entry of headers) {
      const key = entry[0];
      const value = entry[1];
      if (key !== undefined && value !== undefined) {
        result[key] = value;
      }
    }
    return result;
  }

  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string") {
      result[key] = value;
    }
  }

  return result;
};

const createSafeFetch = (options?: SafeFetchOptions): SafeFetch => {
  const safeFetch: SafeFetch = async (input, init) => {
    const initialUrl = input instanceof Request ? input.url : input.toString();
    await validateUrlSafety(initialUrl, options);

    const response = await globalThis.fetch(input, {
      ...init,
      redirect: "manual",
    });

    if (!REDIRECT_STATUS_CODES.has(response.status)) {
      return response;
    }

    let currentUrl = initialUrl;
    let currentResponse = response;
    let currentHeaders = extractHeaders(init?.headers);

    for (let redirectCount = 0; redirectCount < MAX_REDIRECTS; redirectCount++) {
      const redirectUrl = resolveRedirectUrl(currentResponse, currentUrl);
      if (!redirectUrl) {
        return currentResponse;
      }

      await validateUrlSafety(redirectUrl, options);

      if (isCrossOrigin(currentUrl, redirectUrl)) {
        currentHeaders = stripAuthorizationHeader(currentHeaders);
      }

      currentUrl = redirectUrl;

      currentResponse = await globalThis.fetch(currentUrl, {
        ...init,
        headers: currentHeaders,
        redirect: "manual",
      });

      if (!REDIRECT_STATUS_CODES.has(currentResponse.status)) {
        return currentResponse;
      }
    }

    throw new UrlSafetyError(
      `Too many redirects (exceeded ${MAX_REDIRECTS}).`,
    );
  };

  return safeFetch;
};

export { createSafeFetch, UrlSafetyError, validateUrlSafety };
export type { SafeFetchOptions };
