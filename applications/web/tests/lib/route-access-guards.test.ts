import { describe, expect, it } from "bun:test";
import {
  resolveAuthRedirect,
  resolveDashboardRedirect,
  resolveUpgradeRedirect,
} from "../../src/lib/route-access-guards";

describe("route access guards", () => {
  describe("resolveDashboardRedirect", () => {
    const cases = [
      {
        expectedRedirect: "/login",
        hasSession: false,
      },
      {
        expectedRedirect: null,
        hasSession: true,
      },
    ] as const;

    for (const testCase of cases) {
      it(`returns ${String(testCase.expectedRedirect)} when hasSession=${testCase.hasSession}`, () => {
        expect(resolveDashboardRedirect(testCase.hasSession)).toBe(testCase.expectedRedirect);
      });
    }
  });

  describe("resolveAuthRedirect", () => {
    const cases = [
      {
        expectedRedirect: null,
        hasSession: false,
      },
      {
        expectedRedirect: "/dashboard",
        hasSession: true,
      },
    ] as const;

    for (const testCase of cases) {
      it(`returns ${String(testCase.expectedRedirect)} when hasSession=${testCase.hasSession}`, () => {
        expect(resolveAuthRedirect(testCase.hasSession)).toBe(testCase.expectedRedirect);
      });
    }
  });

  describe("resolveUpgradeRedirect", () => {
    const cases = [
      {
        expectedRedirect: "/login",
        hasSession: false,
        plan: null,
      },
      {
        expectedRedirect: "/login",
        hasSession: false,
        plan: "free",
      },
      {
        expectedRedirect: "/dashboard",
        hasSession: true,
        plan: "pro",
      },
      {
        expectedRedirect: null,
        hasSession: true,
        plan: "free",
      },
      {
        expectedRedirect: null,
        hasSession: true,
        plan: null,
      },
    ] as const;

    for (const testCase of cases) {
      it(
        `returns ${String(testCase.expectedRedirect)} when hasSession=${testCase.hasSession} and plan=${String(testCase.plan)}`,
        () => {
          expect(resolveUpgradeRedirect(testCase.hasSession, testCase.plan)).toBe(
            testCase.expectedRedirect,
          );
        },
      );
    }
  });
});
