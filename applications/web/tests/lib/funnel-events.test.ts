import { afterEach, describe, expect, it, vi } from "vitest";
import { reportFunnelEvent } from "../../src/lib/funnel-events";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("reportFunnelEvent", () => {
  it("posts the event to the API so it lands on a server-side wide event", () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    vi.stubGlobal("fetch", fetchMock);

    reportFunnelEvent({ event: "billing.limit_shown", limitType: "accounts" });

    expect(fetchMock).toHaveBeenCalledWith("/api/funnel", {
      body: JSON.stringify({ event: "billing.limit_shown", limitType: "accounts" }),
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      method: "POST",
    });
  });

  it("never throws when the request fails", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));

    expect(() => reportFunnelEvent({ event: "billing.upgrade_viewed" })).not.toThrow();
    await Promise.resolve();
  });
});
