import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import type { PublicRuntimeConfig } from "@/lib/runtime-config";
import { AnalyticsScripts } from "@/components/analytics-scripts";

const { effectiveConsentMock, gdprAppliesMock } = vi.hoisted(() => ({
  effectiveConsentMock: vi.fn(() => false),
  gdprAppliesMock: vi.fn(() => true),
}));

vi.mock("@tanstack/react-router", () => ({
  useLocation: () => ({ pathname: "/" }),
}));

vi.mock("@/hooks/use-effective-consent", () => ({
  useEffectiveConsent: effectiveConsentMock,
}));

vi.mock("@/hooks/use-gdpr-applies", () => ({
  useGdprApplies: gdprAppliesMock,
}));

vi.mock("@/hooks/use-session", () => ({
  useSession: () => ({ user: null }),
}));

const runtimeConfig: PublicRuntimeConfig = {
  commercialMode: true,
  googleAdsConversionLabel: "test-label",
  googleAdsId: "AW-1234567890",
  polarProMonthlyProductId: null,
  polarProYearlyProductId: null,
  visitorsNowToken: null,
};

type GtagCall = [string, string, Record<string, string | number>];

let previousGlobals: Record<string, unknown>;
let gtagSpy: ReturnType<typeof vi.fn>;
let container: HTMLElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  const { document, window } = parseHTML("<html><body><div id='app'></div></body></html>");

  previousGlobals = {
    Event: globalThis.Event,
    HTMLElement: globalThis.HTMLElement,
    Node: globalThis.Node,
    document: globalThis.document,
    window: globalThis.window,
  };

  Object.assign(globalThis, {
    Event: window.Event,
    HTMLElement: window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
    Node: window.Node,
    document,
    window,
  });

  gtagSpy = vi.fn();
  globalThis.gtag = gtagSpy as unknown as typeof globalThis.gtag;

  const appContainer = document.getElementById("app");
  if (!(appContainer instanceof globalThis.HTMLElement)) {
    throw new Error("Expected app container");
  }

  container = appContainer;
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });

  globalThis.gtag = undefined;
  Object.assign(globalThis, previousGlobals);
  vi.clearAllMocks();
});

const consentUpdates = (): GtagCall[] =>
  gtagSpy.mock.calls.filter(
    (call): call is GtagCall => call[0] === "consent" && call[1] === "update",
  );

describe("AnalyticsScripts consent signalling", () => {
  it("grants Google consent on mount when the visitor has effective consent", async () => {
    effectiveConsentMock.mockReturnValue(true);
    gdprAppliesMock.mockReturnValue(false);

    await act(async () => {
      root.render(<AnalyticsScripts runtimeConfig={runtimeConfig} />);
    });

    expect(consentUpdates()).toEqual([
      [
        "consent",
        "update",
        {
          ad_personalization: "granted",
          ad_storage: "granted",
          ad_user_data: "granted",
          analytics_storage: "granted",
        },
      ],
    ]);
  });

  it("keeps Google consent denied on mount when the visitor has not consented", async () => {
    effectiveConsentMock.mockReturnValue(false);
    gdprAppliesMock.mockReturnValue(true);

    await act(async () => {
      root.render(<AnalyticsScripts runtimeConfig={runtimeConfig} />);
    });

    expect(consentUpdates()).toEqual([
      [
        "consent",
        "update",
        {
          ad_personalization: "denied",
          ad_storage: "denied",
          ad_user_data: "denied",
          analytics_storage: "denied",
        },
      ],
    ]);
  });

  it("re-signals consent when the visitor accepts after mount", async () => {
    effectiveConsentMock.mockReturnValue(false);
    gdprAppliesMock.mockReturnValue(true);

    await act(async () => {
      root.render(<AnalyticsScripts runtimeConfig={runtimeConfig} />);
    });

    effectiveConsentMock.mockReturnValue(true);

    await act(async () => {
      root.render(<AnalyticsScripts runtimeConfig={runtimeConfig} />);
    });

    const updates = consentUpdates();
    expect(updates).toHaveLength(2);
    expect(updates[1]?.[2]).toMatchObject({ ad_storage: "granted" });
  });

  it("emits a denied consent default in server markup regardless of client consent", () => {
    effectiveConsentMock.mockReturnValue(true);
    gdprAppliesMock.mockReturnValue(false);

    const markup = renderToStaticMarkup(<AnalyticsScripts runtimeConfig={runtimeConfig} />);

    expect(markup).toContain("'ad_storage': 'denied'");
    expect(markup).not.toContain("'ad_storage': 'granted'");
  });
});
