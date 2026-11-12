import { describe, expect, it, vi } from "vitest";

const { captured } = vi.hoisted(() => ({
  captured: { beforeLoad: null as ((input: { params: { accountId: string } }) => void) | null },
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: { beforeLoad: (input: { params: { accountId: string } }) => void }) => {
    captured.beforeLoad = options.beforeLoad;
    return {};
  },
  redirect: (options: unknown) => ({ redirect: options }),
}));

await import("../../../src/routes/(dashboard)/dashboard/accounts/$accountId.setup");

describe("old account setup route", () => {
  it("sends the removed wizard URL on to the setup page with the account", () => {
    expect(() => captured.beforeLoad?.({ params: { accountId: "account-1" } })).toThrow();
    try {
      captured.beforeLoad?.({ params: { accountId: "account-1" } });
    } catch (thrown) {
      expect(thrown).toEqual({ redirect: { replace: true, search: { accountId: "account-1" }, to: "/dashboard/setup" } });
    }
  });
});
