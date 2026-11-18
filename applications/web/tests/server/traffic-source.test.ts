import { describe, expect, it } from "vitest";
import { resolveTrafficSource } from "../../src/server/traffic-source";

function trafficSourceOf(url: string, headers: Record<string, string> = {}) {
  return resolveTrafficSource(new Request(url, { headers }), new URL(url));
}

describe("resolveTrafficSource", () => {
  it("keeps only the origin of the referrer", () => {
    const source = trafficSourceOf("https://www.keeper.sh/", {
      referer: "https://www.google.com/search?q=calendar+sync&client=private",
    });

    expect(source.referrerOrigin).toBe("https://www.google.com");
  });

  it("reports no referrer origin when the request has no referrer", () => {
    expect(trafficSourceOf("https://www.keeper.sh/").referrerOrigin).toBeNull();
  });

  it("ignores referrers that are not web urls", () => {
    expect(trafficSourceOf("https://www.keeper.sh/", { referer: "android-app://com.google.android.gm/" }).referrerOrigin).toBeNull();
    expect(trafficSourceOf("https://www.keeper.sh/", { referer: "not a url" }).referrerOrigin).toBeNull();
  });

  it("flags campaign links without exposing their values", () => {
    const source = trafficSourceOf("https://www.keeper.sh/?utm_source=newsletter&utm_campaign=launch");

    expect(source.hasUtmParameters).toBe(true);
    expect(source.hasGoogleClickId).toBe(false);
    expect(Object.values(source)).not.toContain("newsletter");
  });

  it("flags Google Ads clicks by their click id", () => {
    const source = trafficSourceOf("https://www.keeper.sh/register?gclid=Cj0KCQ");

    expect(source.hasGoogleClickId).toBe(true);
    expect(source.hasUtmParameters).toBe(false);
  });

  it("matches utm parameters regardless of case", () => {
    expect(trafficSourceOf("https://www.keeper.sh/?UTM_Source=x").hasUtmParameters).toBe(true);
  });

  it("does not mistake look-alike parameters for campaign markers", () => {
    const source = trafficSourceOf("https://www.keeper.sh/?utmost=1&gclidx=2");

    expect(source.hasUtmParameters).toBe(false);
    expect(source.hasGoogleClickId).toBe(false);
  });
});
