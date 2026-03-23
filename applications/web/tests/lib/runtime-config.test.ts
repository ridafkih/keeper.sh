import { describe, expect, it } from "bun:test";
import {
  resolvePublicRuntimeConfig,
  serializePublicRuntimeConfig,
} from "../../src/lib/runtime-config";

describe("resolvePublicRuntimeConfig", () => {
  it("returns normalized runtime values", () => {
    const config = resolvePublicRuntimeConfig({
      googleAdsConversionLabel: "runtime-conversion",
      googleAdsId: "runtime-google",
      visitorsNowToken: "runtime-visitors",
    });

    expect(config).toEqual({
      commercialMode: false,
      gdprApplies: false,
      googleAdsConversionLabel: "runtime-conversion",
      googleAdsId: "runtime-google",
      polarProMonthlyProductId: null,
      polarProYearlyProductId: null,
      visitorsNowToken: "runtime-visitors",
    });
  });

  it("treats missing runtime values as null", () => {
    const config = resolvePublicRuntimeConfig({
      googleAdsConversionLabel: "",
      googleAdsId: undefined,
      visitorsNowToken: null,
    });

    expect(config).toEqual({
      commercialMode: false,
      gdprApplies: false,
      googleAdsConversionLabel: null,
      googleAdsId: null,
      polarProMonthlyProductId: null,
      polarProYearlyProductId: null,
      visitorsNowToken: null,
    });
  });
});

describe("serializePublicRuntimeConfig", () => {
  it("serializes config for safe inline script injection", () => {
    const serialized = serializePublicRuntimeConfig({
      commercialMode: false,
      gdprApplies: false,
      googleAdsConversionLabel: "conversion",
      googleAdsId: "ads-123",
      polarProMonthlyProductId: null,
      polarProYearlyProductId: null,
      visitorsNowToken: "</script><script>alert(1)</script>",
    });

    expect(serialized).toContain("\"googleAdsId\":\"ads-123\"");
    expect(serialized).not.toContain("</script>");
    expect(serialized).toContain("\\u003C/script\\u003E");
  });
});
