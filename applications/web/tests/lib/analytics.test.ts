import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicRuntimeConfig } from "@/lib/runtime-config";
import {
  reportPurchaseConversion,
  reportSignupConversion,
  reportSignupConversionBeforeNavigation,
} from "@/lib/analytics";

const runtimeConfig: PublicRuntimeConfig = {
  commercialMode: true,
  googleAdsConversionLabel: "purchase-label",
  googleAdsId: "AW-1234567890",
  googleAdsSignupConversionLabel: "signup-label",
  googleAnalyticsId: null,
  polarProMonthlyProductId: null,
  polarProYearlyProductId: null,
  visitorsNowToken: null,
};

let gtagSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  gtagSpy = vi.fn();
  globalThis.gtag = gtagSpy as unknown as typeof globalThis.gtag;
});

afterEach(() => {
  globalThis.gtag = undefined;
});

describe("reportPurchaseConversion", () => {
  it("sends the purchase conversion with Google's payload field names", () => {
    reportPurchaseConversion(runtimeConfig, { value: 48, currency: "USD", transactionId: "sub_1" });

    expect(gtagSpy).toHaveBeenCalledWith("event", "conversion", {
      currency: "USD",
      send_to: "AW-1234567890/purchase-label",
      transaction_id: "sub_1",
      value: 48,
    });
  });

  it("omits fields the caller has no value for rather than sending nulls", () => {
    reportPurchaseConversion(runtimeConfig, { value: 48, currency: "USD", transactionId: null });

    expect(gtagSpy).toHaveBeenCalledWith("event", "conversion", {
      currency: "USD",
      send_to: "AW-1234567890/purchase-label",
      value: 48,
    });
  });

  it("stays silent when the purchase label is unset", () => {
    reportPurchaseConversion({ ...runtimeConfig, googleAdsConversionLabel: null });

    expect(gtagSpy).not.toHaveBeenCalled();
  });
});

describe("reportSignupConversion", () => {
  it("sends the signup conversion to its own conversion action", () => {
    reportSignupConversion(runtimeConfig);

    expect(gtagSpy).toHaveBeenCalledWith("event", "conversion", {
      send_to: "AW-1234567890/signup-label",
    });
  });

  it("stays silent when the signup label is unset", () => {
    reportSignupConversion({ ...runtimeConfig, googleAdsSignupConversionLabel: null });

    expect(gtagSpy).not.toHaveBeenCalled();
  });
});

describe("reportSignupConversionBeforeNavigation", () => {
  it("navigates once Google confirms the conversion was sent", () => {
    const navigate = vi.fn();

    reportSignupConversionBeforeNavigation(runtimeConfig, navigate);
    const [, , payload] = gtagSpy.mock.calls[0] as [string, string, { event_callback: () => void; send_to: string }];
    payload.event_callback();
    payload.event_callback();

    expect(payload.send_to).toBe("AW-1234567890/signup-label");
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it("navigates after the timeout when Google never answers", () => {
    vi.useFakeTimers();
    const navigate = vi.fn();

    reportSignupConversionBeforeNavigation(runtimeConfig, navigate);
    expect(navigate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);

    expect(navigate).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("navigates at once when there is nothing to report", () => {
    const navigate = vi.fn();
    globalThis.gtag = undefined;

    reportSignupConversionBeforeNavigation(runtimeConfig, navigate);

    expect(navigate).toHaveBeenCalledTimes(1);
  });
});
