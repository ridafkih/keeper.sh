import { describe, expect, it } from "vitest";
import {
  SIGN_UP_ATTRIBUTION_STORAGE_KEY,
  buildSignUpAttribution,
  readRememberedAttribution,
  rememberFirstVisit,
} from "../../src/lib/sign-up-attribution";
import type { AttributionStorage } from "../../src/lib/sign-up-attribution";

const createStorage = (): AttributionStorage & { entries: Map<string, string> } => {
  const entries = new Map<string, string>();
  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value);
    },
  };
};

describe("buildSignUpAttribution", () => {
  it("keeps the landing path, the referrer's origin and the UTM values", () => {
    expect(buildSignUpAttribution({
      href: "https://www.keeper.sh/compare/onecal?utm_source=reddit&utm_medium=social&utm_campaign=launch&ref=abc",
      referrer: "https://www.reddit.com/r/productivity/comments/abc/",
    })).toEqual({
      landingPath: "/compare/onecal",
      referrerOrigin: "https://www.reddit.com",
      utmCampaign: "launch",
      utmMedium: "social",
      utmSource: "reddit",
    });
  });

  it("leaves out a referrer from Keeper.sh itself", () => {
    expect(buildSignUpAttribution({
      href: "https://www.keeper.sh/register",
      referrer: "https://www.keeper.sh/pricing",
    })).toEqual({ landingPath: "/register" });
  });

  it("leaves out a missing or malformed referrer", () => {
    expect(buildSignUpAttribution({ href: "https://www.keeper.sh/", referrer: "" })).toEqual({ landingPath: "/" });
    expect(buildSignUpAttribution({ href: "https://www.keeper.sh/", referrer: "android-app://com.google.android.gm" }))
      .toEqual({ landingPath: "/" });
  });

  it("cuts long UTM values to the limit", () => {
    const attribution = buildSignUpAttribution({
      href: `https://www.keeper.sh/?utm_campaign=${"c".repeat(300)}`,
      referrer: "",
    });

    expect(attribution?.utmCampaign).toHaveLength(100);
  });
});

describe("rememberFirstVisit", () => {
  it("remembers the first page of the visit and not the ones after it", () => {
    const storage = createStorage();

    rememberFirstVisit(storage, { href: "https://www.keeper.sh/blog/sync?utm_source=google", referrer: "https://www.google.com/" });
    rememberFirstVisit(storage, { href: "https://www.keeper.sh/register", referrer: "https://www.keeper.sh/blog/sync" });

    expect(readRememberedAttribution(storage)).toEqual({
      landingPath: "/blog/sync",
      referrerOrigin: "https://www.google.com",
      utmSource: "google",
    });
  });

  it("reads nothing back from a visit that was never remembered or was tampered with", () => {
    const storage = createStorage();
    expect(readRememberedAttribution(storage)).toBeNull();

    storage.setItem(SIGN_UP_ATTRIBUTION_STORAGE_KEY, "{not json");
    expect(readRememberedAttribution(storage)).toBeNull();

    storage.setItem(SIGN_UP_ATTRIBUTION_STORAGE_KEY, JSON.stringify({ landingPath: "javascript-free?" }));
    expect(readRememberedAttribution(storage)).toBeNull();
  });
});
