import { describe, expect, it } from "vitest";
import { buildContentSecurityPolicy } from "../../src/server/content-security-policy";
import type { PublicRuntimeConfig } from "../../src/lib/runtime-config";

const NGINX_DEFAULT_PROXY_BUFFER_BYTES = 4096;

const selfHostedConfig: PublicRuntimeConfig = {
  commercialMode: false,
  googleAdsConversionLabel: null,
  googleAdsId: null,
  googleAdsSignupConversionLabel: null,
  googleAnalyticsId: null,
  polarProMonthlyProductId: null,
  polarProYearlyProductId: null,
  visitorsNowToken: null,
};

const analyticsOnlyConfig: PublicRuntimeConfig = {
  ...selfHostedConfig,
  googleAnalyticsId: "G-TEST123",
};

const adsAndAnalyticsConfig: PublicRuntimeConfig = {
  ...selfHostedConfig,
  commercialMode: true,
  googleAdsConversionLabel: "test-label",
  googleAdsId: "AW-1234567890",
  googleAnalyticsId: "G-TEST123",
  visitorsNowToken: "visitors-token",
};

function cspDirectives(header: string): Map<string, string[]> {
  return new Map(
    header
      .split(";")
      .map((directive) => directive.trim())
      .filter((directive) => directive.length > 0)
      .map((directive) => {
        const [name, ...sources] = directive.split(/\s+/);
        return [name ?? "", sources] as const;
      }),
  );
}

const PAGE_SCHEME = "https:";

function sourceMatches(source: string, url: URL): boolean {
  const sourceWithScheme = source.includes("://") ? source : `${PAGE_SCHEME}//${source}`;
  const { protocol, host } = new URL(sourceWithScheme.replace("*.", "wildcard."));
  if (protocol !== url.protocol) return false;
  if (!sourceWithScheme.includes("*.")) return host === url.host;
  return url.host.endsWith(host.slice("wildcard".length));
}

function isHostSource(source: string): boolean {
  return !source.startsWith("'") && !source.endsWith(":");
}

function cspAllows(config: PublicRuntimeConfig, directive: string, target: string): boolean {
  const sources = cspDirectives(buildContentSecurityPolicy(config)).get(directive) ?? [];
  return sources.some((source) => isHostSource(source) && sourceMatches(source, new URL(target)));
}

function headerBytes(config: PublicRuntimeConfig): number {
  return new TextEncoder().encode(buildContentSecurityPolicy(config)).byteLength;
}

describe("content security policy without analytics configured", () => {
  it("names no Google host in any directive", () => {
    expect(buildContentSecurityPolicy(selfHostedConfig)).not.toMatch(
      /google|doubleclick|googlesyndication|googleadservices/,
    );
  });

  it("names no visitors.now host", () => {
    expect(buildContentSecurityPolicy(selfHostedConfig)).not.toContain("visitors.now");
  });

  it("fits comfortably inside nginx's default proxy buffer", () => {
    expect(headerBytes(selfHostedConfig)).toBeLessThan(NGINX_DEFAULT_PROXY_BUFFER_BYTES / 8);
  });

  it("keeps the first-party restrictions", () => {
    const directives = cspDirectives(buildContentSecurityPolicy(selfHostedConfig));

    expect(directives.get("default-src")).toEqual(["'self'"]);
    expect(directives.get("frame-ancestors")).toEqual(["'none'"]);
    expect(directives.get("connect-src")).toEqual(["'self'"]);
  });
});

describe("content security policy with Google Analytics alone", () => {
  it("lets the Google tag load", () => {
    expect(cspAllows(analyticsOnlyConfig, "script-src", "https://www.googletagmanager.com/gtag/js")).toBe(true);
  });

  it("lets GA4 post hits to its collectors", () => {
    expect(cspAllows(analyticsOnlyConfig, "connect-src", "https://analytics.google.com/g/collect")).toBe(true);
    expect(cspAllows(analyticsOnlyConfig, "connect-src", "https://region1.google-analytics.com/g/collect")).toBe(true);
    expect(cspAllows(analyticsOnlyConfig, "connect-src", "https://region1.analytics.google.com/g/collect")).toBe(true);
  });

  it("leaves out the Google Ads hosts and regional Google domains", () => {
    const header = buildContentSecurityPolicy(analyticsOnlyConfig);

    expect(header).not.toMatch(/doubleclick|googleadservices|googlesyndication/);
    expect(cspAllows(analyticsOnlyConfig, "connect-src", "https://www.google.co.uk/pagead/1p-user-list/1/")).toBe(false);
  });

  it("fits inside nginx's default proxy buffer", () => {
    expect(headerBytes(analyticsOnlyConfig)).toBeLessThan(NGINX_DEFAULT_PROXY_BUFFER_BYTES / 4);
  });
});

describe("content security policy with Google Ads and Analytics", () => {
  it("lets Google Ads load its conversion scripts", () => {
    expect(cspAllows(adsAndAnalyticsConfig, "script-src", "https://www.googletagmanager.com/gtag/js")).toBe(true);
    expect(cspAllows(adsAndAnalyticsConfig, "script-src", "https://www.googleadservices.com/pagead/conversion_async.js")).toBe(true);
    expect(cspAllows(adsAndAnalyticsConfig, "script-src", "https://googleads.g.doubleclick.net/pagead/viewthroughconversion/1/")).toBe(true);
  });

  it("lets Google Ads ping conversions over fetch", () => {
    for (const target of [
      "https://www.googleadservices.com/pagead/conversion/1/",
      "https://googleads.g.doubleclick.net/pagead/viewthroughconversion/1/",
      "https://ad.doubleclick.net/activity",
      "https://www.google.com/pagead/1p-conversion/1/",
      "https://pagead2.googlesyndication.com/ccm/collect",
    ]) {
      expect(cspAllows(adsAndAnalyticsConfig, "connect-src", target)).toBe(true);
    }
  });

  it("lets Google Ads fall back to pixel pings", () => {
    for (const target of [
      "https://www.googleadservices.com/pagead/conversion/1/",
      "https://googleads.g.doubleclick.net/pagead/viewthroughconversion/1/",
      "https://www.google.com/pagead/1p-conversion/1/",
      "https://pagead2.googlesyndication.com/ccm/collect",
    ]) {
      expect(cspAllows(adsAndAnalyticsConfig, "img-src", target)).toBe(true);
    }
  });

  it("lets GA4 post hits to the analytics.google.com apex", () => {
    expect(cspAllows(adsAndAnalyticsConfig, "connect-src", "https://analytics.google.com/g/collect")).toBe(true);
    expect(cspAllows(adsAndAnalyticsConfig, "img-src", "https://region1.google-analytics.com/g/collect")).toBe(true);
  });

  it("lets GA4 reach the doubleclick hosts Google Ads-linked properties use", () => {
    expect(cspAllows(adsAndAnalyticsConfig, "connect-src", "https://stats.g.doubleclick.net/g/collect")).toBe(true);
    expect(cspAllows(adsAndAnalyticsConfig, "img-src", "https://stats.g.doubleclick.net/g/collect")).toBe(true);
  });

  it("lets Google Ads conversions ping regional Google domains", () => {
    expect(cspAllows(adsAndAnalyticsConfig, "img-src", "https://www.google.ca/pagead/1p-conversion/1/")).toBe(true);
    expect(cspAllows(adsAndAnalyticsConfig, "connect-src", "https://www.google.co.uk/pagead/1p-user-list/1/")).toBe(true);
  });

  it("lets Google tags reach any subdomain of a regional Google domain", () => {
    expect(cspAllows(adsAndAnalyticsConfig, "img-src", "https://adservice.google.ca/ddm/fls/z/")).toBe(true);
    expect(cspAllows(adsAndAnalyticsConfig, "connect-src", "https://adservice.google.co.uk/ddm/fls/z/")).toBe(true);
  });

  it("lets the Google tag load its service worker frame", () => {
    expect(cspAllows(adsAndAnalyticsConfig, "frame-src", "https://www.googletagmanager.com/static/service_worker/")).toBe(true);
  });

  it("lets visitors.now load and report", () => {
    expect(cspAllows(adsAndAnalyticsConfig, "script-src", "https://cdn.visitors.now/v.js")).toBe(true);
    expect(cspAllows(adsAndAnalyticsConfig, "connect-src", "https://e.visitors.now/e")).toBe(true);
  });

  it("still refuses hosts outside Google's documented list", () => {
    expect(cspAllows(adsAndAnalyticsConfig, "connect-src", "https://analytics.example.com/g/collect")).toBe(false);
  });

  it("refuses plain-http beacons to regional Google domains", () => {
    expect(cspAllows(adsAndAnalyticsConfig, "connect-src", "http://www.google.ca/pagead/1p-user-list/1/")).toBe(false);
  });
});
