import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { atom, getDefaultStore, useAtomValue } from "jotai";
import { mountHook } from "../../helpers/mount-hook";
import type { OnboardingStep } from "../../../src/features/onboarding/onboarding-step";

const tracked = vi.hoisted((): [string, unknown][] => []);

vi.mock("@/lib/analytics", () => ({
  ANALYTICS_EVENTS: { onboarding_completed: "onboarding_completed" },
  track: (event: string, properties: unknown) => tracked.push([event, properties]),
}));

const { onboardingRunAtom } = await import("../../../src/state/onboarding");
const { useSettleFirstSync } = await import("../../../src/features/onboarding/use-settle-first-sync");

const viewAtom = atom<{ step: OnboardingStep; copiedCount: number | null }>({ copiedCount: null, step: "copying" });

const show = (step: OnboardingStep, copiedCount: number | null): void => {
  React.act(() => {
    getDefaultStore().set(viewAtom, { copiedCount, step });
  });
};

const mountSettler = () => mountHook(() => {
  const { step, copiedCount } = useAtomValue(viewAtom);
  useSettleFirstSync(step, copiedCount);
});

beforeEach(() => {
  tracked.length = 0;
  getDefaultStore().set(onboardingRunAtom, { phase: "started", startedAfterSeq: 1 });
  getDefaultStore().set(viewAtom, { copiedCount: null, step: "copying" });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useSettleFirstSync", () => {
  it("tracks onboarding_completed once, even as the copy count keeps moving", () => {
    const settler = mountSettler();

    show("copied", 1100);
    show("copied", 1150);
    show("copied", 1200);

    expect(tracked).toEqual([["onboarding_completed", { events_copied: 1100 }]]);
    expect(getDefaultStore().get(onboardingRunAtom)).toEqual({ outcome: "copied", phase: "settled" });
    settler.unmount();
  });

  it("does not track again when the step is mounted a second time", () => {
    const first = mountSettler();
    show("copied", 1200);
    first.unmount();

    const second = mountSettler();
    show("copied", 1200);
    second.unmount();

    expect(tracked).toHaveLength(1);
  });

  it("settles an empty first run without counting it as completed", () => {
    const settler = mountSettler();

    show("nothing-to-copy", 0);

    expect(tracked).toEqual([]);
    expect(getDefaultStore().get(onboardingRunAtom)).toEqual({ outcome: "nothing-to-copy", phase: "settled" });
    settler.unmount();
  });

  it("waits while the first sync is still copying", () => {
    const settler = mountSettler();

    show("copying", null);

    expect(tracked).toEqual([]);
    expect(getDefaultStore().get(onboardingRunAtom).phase).toBe("started");
    settler.unmount();
  });
});
