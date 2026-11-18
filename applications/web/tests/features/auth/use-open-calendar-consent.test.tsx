import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountHook } from "../../helpers/mount-hook";

const calls = vi.hoisted(() => ({
  hasMarker: false,
  replaced: [] as string[],
  reported: [] as string[],
  tracked: [] as [string, unknown][],
}));

vi.mock("@/lib/analytics", () => ({
  ANALYTICS_EVENTS: { oauth_authorize_started: "oauth_authorize_started", signup_completed: "signup_completed" },
  reportSignupConversionBeforeNavigation: (_config: unknown, navigate: () => void) => {
    calls.reported.push("signup");
    navigate();
  },
  track: (event: string, properties: unknown) => calls.tracked.push([event, properties]),
}));

vi.mock("@/lib/runtime-config", () => ({ getPublicRuntimeConfig: () => ({}) }));

vi.mock("@/lib/signup-marker", () => ({
  consumeSignupMarker: () => {
    const had = calls.hasMarker;
    calls.hasMarker = false;
    return had;
  },
}));

const { useOpenCalendarConsent } = await import("../../../src/features/auth/use-open-calendar-consent");

const previousLocation = globalThis.location;

beforeEach(() => {
  calls.replaced.length = 0;
  calls.reported.length = 0;
  calls.tracked.length = 0;
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: { replace: (url: string) => calls.replaced.push(url) },
  });
});

afterEach(() => {
  Object.defineProperty(globalThis, "location", { configurable: true, value: previousLocation });
});

describe("useOpenCalendarConsent", () => {
  it("reports the sign-up, then opens consent for the signed-in account", () => {
    calls.hasMarker = true;

    const mounted = mountHook(() => useOpenCalendarConsent("google"));

    expect(calls.tracked.map(([event]) => event)).toEqual(["oauth_authorize_started", "signup_completed"]);
    expect(calls.reported).toEqual(["signup"]);
    expect(calls.replaced).toEqual(["/api/sources/authorize?provider=google&account=sign-in"]);
    mounted.unmount();
  });

  it("opens consent straight away when the sign-up was already reported", () => {
    calls.hasMarker = false;

    const mounted = mountHook(() => useOpenCalendarConsent("outlook"));

    expect(calls.reported).toEqual([]);
    expect(calls.replaced).toEqual(["/api/sources/authorize?provider=outlook&account=sign-in"]);
    mounted.unmount();
  });
});
