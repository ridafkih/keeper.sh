import { beforeEach, describe, expect, it, vi } from "vitest";
import { createGoogleSyncProvider } from "../../../../src/providers/google/destination/provider";
import { serializeGoogleEvent } from "../../../../src/providers/google/destination/serialize-event";
import type { EventConference } from "../../../../src/core/events/conference";
import type { MaterializedSyncableEvent } from "../../../../src/core/types";
import type { BatchSubRequest } from "../../../../src/providers/google/shared/batch";

const batchMocks = vi.hoisted(() => ({
  executeBatchChunked: vi.fn(),
}));

vi.mock("../../../../src/providers/google/shared/batch", () => ({
  executeBatchChunked: batchMocks.executeBatchChunked,
}));

const MEET_URI = "https://meet.google.com/abc-defg-hij";

const conference: EventConference = {
  solution: "hangoutsMeet",
  conferenceId: "abc-defg-hij",
  entryPoints: [
    { type: "video", uri: MEET_URI, label: "meet.google.com/abc-defg-hij" },
    { type: "phone", uri: "tel:+15550100", label: "+1 555-0100", pin: "123456" },
  ],
};

const createProvider = () => createGoogleSyncProvider({
  accessToken: "test-token",
  refreshToken: "test-refresh",
  accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
  externalCalendarId: "primary",
  calendarId: "cal-1",
  userId: "user-1",
});

const createEvent = (
  overrides: Partial<MaterializedSyncableEvent> = {},
): MaterializedSyncableEvent => ({
  calendarId: "source-calendar",
  calendarName: "Work",
  calendarUrl: null,
  endTime: new Date("2026-09-10T11:00:00Z"),
  id: "event-state-id",
  sourceEventUid: "source-event@google.com",
  startTime: new Date("2026-09-10T10:00:00Z"),
  summary: "Weekly sync",
  ...overrides,
});

const batchResponse = (statusCode: number, body: unknown) => ({
  body,
  headers: {},
  statusCode,
});

const IMPORTED = batchResponse(200, { id: "google-event-id" });

const sentRequests = (call = 0): BatchSubRequest[] =>
  batchMocks.executeBatchChunked.mock.calls[call]?.[0] ?? [];

const sentBody = (call = 0, index = 0): Record<string, unknown> =>
  sentRequests(call)[index]?.body as Record<string, unknown>;

describe("writing a conference to a Google destination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("declares conferenceDataVersion=1 on a write that carries a meeting", async () => {
    batchMocks.executeBatchChunked.mockResolvedValueOnce([IMPORTED]);

    await createProvider().pushEvents([createEvent({ conference })]);

    expect(sentRequests()[0]?.path).toContain("conferenceDataVersion=1");
  });

  it("declares conferenceDataVersion=1 on a write that carries none", async () => {
    batchMocks.executeBatchChunked.mockResolvedValueOnce([IMPORTED]);

    await createProvider().pushEvents([createEvent()]);

    expect(sentRequests()[0]?.path).toContain("conferenceDataVersion=1");
  });

  it("declares conferenceDataVersion=1 on every write in a mixed batch", async () => {
    batchMocks.executeBatchChunked.mockResolvedValueOnce([IMPORTED, IMPORTED, IMPORTED]);

    await createProvider().pushEvents([
      createEvent({ id: "a", conference }),
      createEvent({ id: "b" }),
      createEvent({ id: "c", conference }),
    ]);

    expect(sentRequests()).toHaveLength(3);
    for (const request of sentRequests()) {
      expect(request.path).toContain("conferenceDataVersion=1");
    }
  });

  it("copies the meeting the source owns instead of requesting a new one", async () => {
    batchMocks.executeBatchChunked.mockResolvedValueOnce([IMPORTED]);

    await createProvider().pushEvents([createEvent({ conference })]);

    expect(sentBody().conferenceData).toEqual({
      conferenceSolution: { key: { type: "hangoutsMeet" } },
      conferenceId: "abc-defg-hij",
      entryPoints: [
        { entryPointType: "video", uri: MEET_URI, label: "meet.google.com/abc-defg-hij" },
        { entryPointType: "phone", uri: "tel:+15550100", label: "+1 555-0100", pin: "123456" },
      ],
    });
    expect(JSON.stringify(sentBody())).not.toContain("createRequest");
  });

  it("sends no conference for an event that has none", async () => {
    batchMocks.executeBatchChunked.mockResolvedValueOnce([IMPORTED]);

    await createProvider().pushEvents([createEvent()]);

    expect(sentBody()).not.toHaveProperty("conferenceData");
  });

  it("drops the mirrored meeting when the source loses it", async () => {
    batchMocks.executeBatchChunked
      .mockResolvedValueOnce([IMPORTED])
      .mockResolvedValueOnce([IMPORTED]);

    const provider = createProvider();
    await provider.pushEvents([createEvent({ conference })]);
    await provider.pushEvents([createEvent()]);

    expect(sentBody(0)).toHaveProperty("conferenceData");
    /*
     * The removal is the omission itself: with conferenceDataVersion=1 an absent
     * field tells Google to detach the conference from the upserted event.
     */
    expect(sentBody(1)).not.toHaveProperty("conferenceData");
    expect(sentRequests(1)[0]?.path).toContain("conferenceDataVersion=1");
  });

  it("attaches the meeting to every occurrence pushed for a series", async () => {
    batchMocks.executeBatchChunked.mockResolvedValueOnce([IMPORTED, IMPORTED]);

    await createProvider().pushEvents([
      createEvent({ id: "occurrence-1", conference }),
      createEvent({
        id: "occurrence-2",
        conference,
        startTime: new Date("2026-09-17T10:00:00Z"),
        endTime: new Date("2026-09-17T11:00:00Z"),
      }),
    ]);

    expect(sentBody(0, 0).conferenceData).toBeDefined();
    expect(sentBody(0, 1).conferenceData).toBeDefined();
  });

  it("keeps a single occurrence's meeting off the occurrences without one", async () => {
    batchMocks.executeBatchChunked.mockResolvedValueOnce([IMPORTED, IMPORTED]);

    await createProvider().pushEvents([
      createEvent({ id: "occurrence-1" }),
      createEvent({ id: "occurrence-2", conference }),
    ]);

    expect(sentBody(0, 0)).not.toHaveProperty("conferenceData");
    expect(sentBody(0, 1).conferenceData).toBeDefined();
  });
});

describe("when Google refuses the conference", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const rejection = batchResponse(400, {
    error: {
      code: 400,
      message: "Invalid conference type value.",
      errors: [{ reason: "invalid" }],
    },
  });

  it("re-sends the event without the conference rather than losing it", async () => {
    batchMocks.executeBatchChunked
      .mockResolvedValueOnce([rejection])
      .mockResolvedValueOnce([IMPORTED]);

    const provider = createProvider();
    const [result] = await provider.pushEvents([createEvent({ conference })]);

    expect(sentBody(0)).toHaveProperty("conferenceData");
    expect(sentBody(1)).not.toHaveProperty("conferenceData");
    expect(sentRequests(1)[0]?.path).toContain("conferenceDataVersion=1");
    expect(result).toMatchObject({ deleteId: "google-event-id", success: true });
    expect(provider.getSyncDiagnostics()).toMatchObject({
      "conference.attached": 1,
      "conference.recovered_without_conference": 1,
      "conference.rejected": 1,
    });
  });

  it("keeps the original failure when the retry fails too", async () => {
    batchMocks.executeBatchChunked
      .mockResolvedValueOnce([rejection])
      .mockResolvedValueOnce([batchResponse(400, { error: { message: "Still invalid." } })]);

    const provider = createProvider();
    const [result] = await provider.pushEvents([createEvent({ conference })]);

    expect(result).toMatchObject({
      error: "Invalid conference type value.",
      errorType: "GoogleCalendarApiError",
      statusCode: 400,
      success: false,
    });
    expect(provider.getSyncDiagnostics()["conference.recovered_without_conference"]).toBe(0);
  });

  it("leaves a rate-limited write to the batch layer instead of stripping its conference", async () => {
    batchMocks.executeBatchChunked.mockResolvedValueOnce([
      batchResponse(429, { error: { code: 429, message: "rateLimitExceeded" } }),
    ]);

    const provider = createProvider();
    await provider.pushEvents([createEvent({ conference })]);

    expect(batchMocks.executeBatchChunked).toHaveBeenCalledTimes(1);
    expect(provider.getSyncDiagnostics()["conference.rejected"]).toBe(0);
  });

  it("never retries a write that carried no conference", async () => {
    batchMocks.executeBatchChunked.mockResolvedValueOnce([rejection]);

    const provider = createProvider();
    const [result] = await provider.pushEvents([createEvent()]);

    expect(batchMocks.executeBatchChunked).toHaveBeenCalledTimes(1);
    expect(result?.success).toBe(false);
    expect(provider.getSyncDiagnostics()["conference.attached"]).toBe(0);
  });

  it("reports counts only, never a join link or a dial-in PIN", async () => {
    batchMocks.executeBatchChunked
      .mockResolvedValueOnce([rejection])
      .mockResolvedValueOnce([IMPORTED]);

    const provider = createProvider();
    await provider.pushEvents([createEvent({ conference })]);

    const diagnostics = JSON.stringify(provider.getSyncDiagnostics());
    expect(diagnostics).not.toContain("meet.google.com");
    expect(diagnostics).not.toContain("123456");
    for (const value of Object.values(provider.getSyncDiagnostics())) {
      expect(typeof value).toBe("number");
    }
  });
});

describe("serializing a conference onto a recurring master", () => {
  it("keeps the meeting alongside the recurrence rule", () => {
    const resource = serializeGoogleEvent(
      createEvent({ conference }),
      "destination-uid",
      "FREQ=WEEKLY;BYDAY=TH",
    );

    expect(resource?.recurrence).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=TH"]);
    expect(resource?.conferenceData?.entryPoints?.[0]?.uri).toBe(MEET_URI);
  });

  it("omits the conference from a working-elsewhere event it refuses to write", () => {
    expect(serializeGoogleEvent(
      createEvent({ availability: "workingElsewhere", conference }),
      "destination-uid",
    )).toBeNull();
  });
});
