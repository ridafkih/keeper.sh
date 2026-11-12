import { describe, expect, it } from "vitest";
import { parseSignUpAttribution } from "../src/sign-up-attribution";

describe("parseSignUpAttribution", () => {
  it("keeps a landing path, referrer origin and UTM values", () => {
    expect(parseSignUpAttribution({
      landingPath: "/blog/sync-google-and-outlook",
      referrerOrigin: "https://www.google.com",
      utmCampaign: "launch week",
      utmMedium: "social",
      utmSource: "reddit",
    })).toEqual({
      landingPath: "/blog/sync-google-and-outlook",
      referrerOrigin: "https://www.google.com",
      utmCampaign: "launch week",
      utmMedium: "social",
      utmSource: "reddit",
    });
  });

  it("drops each field that is malformed and keeps the rest", () => {
    expect(parseSignUpAttribution({
      landingPath: "/pricing?coupon=abc",
      referrerOrigin: "https://www.google.com/search?q=keeper",
      utmSource: "newsletter",
    })).toEqual({ utmSource: "newsletter" });
  });

  it("refuses a referrer that is not a web origin", () => {
    expect(parseSignUpAttribution({ referrerOrigin: "ftp://files.example.com" })).toBeNull();
    expect(parseSignUpAttribution({ referrerOrigin: "android-app://com.google.android.gm" })).toBeNull();
  });

  it("refuses values over the length limits", () => {
    expect(parseSignUpAttribution({
      landingPath: `/${"a".repeat(200)}`,
      utmCampaign: "c".repeat(101),
    })).toBeNull();
  });

  it("refuses UTM values that could carry an email address", () => {
    expect(parseSignUpAttribution({ utmCampaign: "person@example.com" })).toBeNull();
  });

  it("trims UTM values and ignores blank ones", () => {
    expect(parseSignUpAttribution({ utmMedium: "  ", utmSource: " github " })).toEqual({ utmSource: "github" });
  });

  it("ignores fields it does not know and values that are not objects", () => {
    expect(parseSignUpAttribution({ email: "person@example.com" })).toBeNull();
    expect(parseSignUpAttribution("/pricing")).toBeNull();
    expect(parseSignUpAttribution(null)).toBeNull();
    expect(parseSignUpAttribution(["/pricing"])).toBeNull();
  });
});
