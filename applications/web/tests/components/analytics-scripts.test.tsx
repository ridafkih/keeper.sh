import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import type { PublicRuntimeConfig } from "@/lib/runtime-config";
import { AnalyticsScripts } from "@/components/analytics-scripts";

const { effectiveConsentMock, gdprAppliesMock, locationMock } = vi.hoisted(() => ({
  effectiveConsentMock: vi.fn(() => false),
  gdprAppliesMock: vi.fn(() => true),
  locationMock: vi.fn(() => ({ pathname: "/" })),
}));

vi.mock("@tanstack/react-router", () => ({
  useLocation: locationMock,
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
  googleAdsSignupConversionLabel: "signup-label",
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

  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: { href: "https://www.keeper.sh/", origin: "https://www.keeper.sh" },
    writable: true,
  });
  Object.defineProperty(globalThis, "history", {
    configurable: true,
    value: { replaceState: () => undefined },
    writable: true,
  });

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
  Reflect.deleteProperty(globalThis, "location");
  Reflect.deleteProperty(globalThis, "history");
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

describe("AnalyticsScripts page views", () => {
  const pageViews = (): GtagCall[] =>
    gtagSpy.mock.calls.filter(
      (call): call is GtagCall => call[0] === "event" && call[1] === "page_view",
    );

  it("does not double-count the initial page view already sent by gtag config", async () => {
    locationMock.mockReturnValue({ pathname: "/" });

    await act(async () => {
      root.render(<AnalyticsScripts runtimeConfig={runtimeConfig} />);
    });

    expect(pageViews()).toHaveLength(0);
  });

  it("sends a Google Ads page view on client-side navigation", async () => {
    locationMock.mockReturnValue({ pathname: "/" });

    await act(async () => {
      root.render(<AnalyticsScripts runtimeConfig={runtimeConfig} />);
    });

    locationMock.mockReturnValue({ pathname: "/blog" });

    await act(async () => {
      root.render(<AnalyticsScripts runtimeConfig={runtimeConfig} />);
    });

    expect(pageViews()).toEqual([
      ["event", "page_view", { page_path: "/blog", send_to: "AW-1234567890" }],
    ]);
  });

  it("stays silent when no Google Ads id is configured", async () => {
    locationMock.mockReturnValue({ pathname: "/" });

    await act(async () => {
      root.render(<AnalyticsScripts runtimeConfig={{ ...runtimeConfig, googleAdsId: null }} />);
    });

    locationMock.mockReturnValue({ pathname: "/blog" });

    await act(async () => {
      root.render(<AnalyticsScripts runtimeConfig={{ ...runtimeConfig, googleAdsId: null }} />);
    });

    expect(pageViews()).toHaveLength(0);
  });
});

describe("AnalyticsScripts oauth signup conversions", () => {
  const conversions = (): GtagCall[] =>
    gtagSpy.mock.calls.filter(
      (call): call is GtagCall => call[0] === "event" && call[1] === "conversion",
    );

  const stubLocation = (href: string): { replaced: string[] } => {
    const replaced: string[] = [];

    Object.defineProperty(globalThis, "location", {
      configurable: true,
      value: { href, origin: "https://www.keeper.sh" },
      writable: true,
    });
    Object.defineProperty(globalThis, "history", {
      configurable: true,
      value: {
        replaceState: (_state: unknown, _title: string, url: string) => {
          replaced.push(url);
        },
      },
      writable: true,
    });

    return { replaced };
  };

  it("reports a signup conversion when better-auth lands a first-time oauth user", async () => {
    const { replaced } = stubLocation("https://www.keeper.sh/dashboard?keeper_signup=1");

    await act(async () => {
      root.render(
        <AnalyticsScripts
          runtimeConfig={{ ...runtimeConfig, googleAdsSignupConversionLabel: "signup-label" }}
        />,
      );
    });

    expect(conversions()).toEqual([
      ["event", "conversion", { send_to: "AW-1234567890/signup-label" }],
    ]);
    expect(replaced).toEqual(["/dashboard"]);
  });

  it("stays silent for a returning oauth user landing without the marker", async () => {
    stubLocation("https://www.keeper.sh/dashboard");

    await act(async () => {
      root.render(<AnalyticsScripts runtimeConfig={runtimeConfig} />);
    });

    expect(conversions()).toHaveLength(0);
  });

  it("reports once even if the marked url is rendered again", async () => {
    const stub = stubLocation("https://www.keeper.sh/dashboard?keeper_signup=1");

    await act(async () => {
      root.render(<AnalyticsScripts runtimeConfig={runtimeConfig} />);
    });

    globalThis.location.href = `https://www.keeper.sh${stub.replaced[0]}`;

    await act(async () => {
      root.render(<AnalyticsScripts runtimeConfig={{ ...runtimeConfig }} />);
    });

    expect(conversions()).toHaveLength(1);
  });
});
