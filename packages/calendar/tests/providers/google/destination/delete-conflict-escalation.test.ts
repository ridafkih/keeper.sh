import { afterEach, describe, expect, it, vi } from "vitest";
import { createGoogleSyncProvider } from "../../../../src/providers/google/destination/provider";

const CONFLICT_BODY = {
  error: {
    code: 409,
    errors: [{ domain: "global", message: "Conflict", reason: "conflict" }],
    message: "Conflict",
  },
};

const conflictBatchResponse = (): Response => new Response([
  "--response_boundary",
  "Content-Type: application/http",
  "Content-ID: <response-item-0>",
  "",
  "HTTP/1.1 409 Conflict",
  "Content-Type: application/json",
  "",
  JSON.stringify(CONFLICT_BODY),
  "--response_boundary--",
].join("\r\n"), {
  headers: { "Content-Type": "multipart/mixed; boundary=response_boundary" },
  status: 200,
});

const createProvider = () => createGoogleSyncProvider({
  accessToken: "test-token",
  accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
  calendarId: "cal-1",
  externalCalendarId: "primary",
  refreshToken: "test-refresh",
  userId: "user-1",
});

const stubConflictThenSingle = (single: () => Response) => {
  vi.stubGlobal("fetch", vi.fn((input: URL | string) => {
    if (String(input).includes("/batch/")) {
      return Promise.resolve(conflictBatchResponse());
    }
    return Promise.resolve(single());
  }));
};

describe("a Google delete that conflicts inside a batch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([404, 410])("counts a %i on the individual retry as already deleted", async (status) => {
    stubConflictThenSingle(() => Response.json({ error: { code: status, message: "Gone" } }, { status }));
    const provider = createProvider();

    await expect(provider.deleteEvents(["google-event-id"])).resolves.toEqual([{ success: true }]);
    expect(provider.getSyncDiagnostics()).toEqual({
      "provider.google.conflict_retried_in_batch_count": 1,
      "provider.google.conflict_retried_individually_count": 1,
      "provider.google.conflict_unresolved_count": 0,
    });
  });

  it("reports Google's reason and message when every retry conflicts", async () => {
    stubConflictThenSingle(() => Response.json(CONFLICT_BODY, { status: 409 }));
    const provider = createProvider();

    await expect(provider.deleteEvents(["google-event-id"])).resolves.toEqual([{
      error: "Conflict",
      errorType: "GoogleCalendarApiError",
      reason: "conflict",
      statusCode: 409,
      success: false,
    }]);
    expect(provider.getSyncDiagnostics()["provider.google.conflict_unresolved_count"]).toBe(1);
  });

  it("reports no conflict diagnostics when nothing conflicted", () => {
    expect(createProvider().getSyncDiagnostics()).toEqual({});
  });
});
