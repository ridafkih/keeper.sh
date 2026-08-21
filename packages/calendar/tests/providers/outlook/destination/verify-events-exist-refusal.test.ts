import { afterEach, describe, expect, it, vi } from "vitest";
import { createOutlookSyncProvider } from "../../../../src/providers/outlook/destination/provider";

const createProvider = () =>
  createOutlookSyncProvider({
    accessToken: "test-token",
    refreshToken: "test-refresh",
    accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
    externalCalendarId: "external-cal-1",
    calendarId: "cal-1",
    userId: "user-1",
  });

const graphError = (status: number, code: string, headers?: Record<string, string>): Response =>
  Response.json(
    { error: { code, message: `${code} from Graph.` } },
    { headers, status },
  );

describe("verifyEventsExist refusals never vote to delete", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not report a throttled id as missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(graphError(429, "ApplicationThrottled", { "Retry-After": "0" }))),
    );

    await expect(createProvider().verifyEventsExist(["mapped-event-id"]))
      .rejects.toThrow();
  });

  it("does not report an id as missing when the token expired mid-loop", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(graphError(401, "InvalidAuthenticationToken"))),
    );

    await expect(createProvider().verifyEventsExist(["mapped-event-id"]))
      .rejects.toThrow();
  });

  it("does not report an id as missing on a server error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(graphError(500, "InternalServerError"))),
    );

    await expect(createProvider().verifyEventsExist(["mapped-event-id"]))
      .rejects.toThrow();
  });

  it("does not report an id as missing when the request fails at the transport", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("fetch failed"))),
    );

    await expect(createProvider().verifyEventsExist(["mapped-event-id"]))
      .rejects.toThrow();
  });

  it("does not report a batch of ids as missing when the service is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(graphError(503, "ServiceUnavailable", { "Retry-After": "0" }))),
    );

    await expect(createProvider().verifyEventsExist(["first-id", "second-id"]))
      .rejects.toThrow();
  });

  it("reports an id as missing only when the destination definitively says not found", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(null, { status: 404 }))));

    await expect(createProvider().verifyEventsExist(["deleted-event-id"])).resolves.toEqual([]);
  });
});
