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

/* A refusal is not an observation of the object: it answers unknown, which never licenses a
   recreate, rather than the absence a create would be decided on. */
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
      .resolves.toEqual([{ identifier: "mapped-event-id", status: "unknown" }]);
  });

  it("does not report an id as missing when the token expired mid-loop", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(graphError(401, "InvalidAuthenticationToken"))),
    );

    await expect(createProvider().verifyEventsExist(["mapped-event-id"]))
      .resolves.toEqual([{ identifier: "mapped-event-id", status: "unknown" }]);
  });

  it("does not report an id as missing on a server error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(graphError(500, "InternalServerError"))),
    );

    await expect(createProvider().verifyEventsExist(["mapped-event-id"]))
      .resolves.toEqual([{ identifier: "mapped-event-id", status: "unknown" }]);
  });

  it("does not report an id as missing when the request fails at the transport", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("fetch failed"))),
    );

    await expect(createProvider().verifyEventsExist(["mapped-event-id"]))
      .resolves.toEqual([{ identifier: "mapped-event-id", status: "unknown" }]);
  });

  it("does not report a batch of ids as missing when the service is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(graphError(503, "ServiceUnavailable", { "Retry-After": "0" }))),
    );

    await expect(createProvider().verifyEventsExist(["first-id", "second-id"]))
      .resolves.toEqual([
        { identifier: "first-id", status: "unknown" },
        { identifier: "second-id", status: "unknown" },
      ]);
  });

  /* A dead item id is not proof of absence on Graph, which re-keys an item on a cross-folder move.
     Absence needs the uid resolved too, so an unresolvable 404 answers unknown. */
  it("reports a bare 404 id as unknown, and one the mailbox holds nowhere as missing", async () => {
    vi.stubGlobal("fetch", vi.fn((input: string | URL | Request) => {
      if (new URL(input.toString()).searchParams.has("$filter")) {
        return Promise.resolve(Response.json({ value: [] }));
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    }));

    const provider = createProvider();

    await expect(provider.verifyEventsExist(["deleted-event-id"])).resolves.toEqual([
      { identifier: "deleted-event-id", status: "unknown" },
    ]);
    await expect(
      provider.verifyEventsExist([{ deleteId: "deleted-event-id", uid: "deleted-event-uid" }]),
    ).resolves.toEqual([{ identifier: "deleted-event-id", status: "absent" }]);
  });
});
