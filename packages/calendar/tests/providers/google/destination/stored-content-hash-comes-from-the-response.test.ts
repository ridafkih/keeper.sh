import { beforeEach, describe, expect, it, vi } from "vitest";
import { createGoogleSyncProvider } from "../../../../src/providers/google/destination/provider";
import {
  createEditableEventContentSnapshot,
  hashEditableEventContentSnapshot,
} from "../../../../src/core/events/content-hash";
import type { MaterializedSyncableEvent } from "../../../../src/core/types";

const batchMocks = vi.hoisted(() => ({
  executeBatchChunked: vi.fn(),
}));

vi.mock("../../../../src/providers/google/shared/batch", () => ({
  executeBatchChunked: batchMocks.executeBatchChunked,
}));

const START = new Date("2026-04-14T09:00:00.000Z");
const END = new Date("2026-04-14T10:00:00.000Z");

/*
 * Google keeps a description of at most 8192 characters, so a longer one comes back shortened.
 * The two forms must hash differently or this test proves nothing.
 */
const SENT_DESCRIPTION = "d".repeat(9014);
const STORED_DESCRIPTION = "d".repeat(8192);

const createProvider = () => createGoogleSyncProvider({
  accessToken: "test-token",
  refreshToken: "test-refresh",
  accessTokenExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
  externalCalendarId: "primary",
  calendarId: "cal-1",
  userId: "user-1",
});

const createEvent = (): MaterializedSyncableEvent => ({
  calendarId: "source-calendar-id",
  calendarName: "Source",
  calendarUrl: null,
  description: SENT_DESCRIPTION,
  endTime: END,
  id: "event-state-id-1",
  location: "Room 4",
  sourceEventUid: "source-event-uid-1",
  startTime: START,
  summary: "Quarterly review",
});

const hashOfDescription = (description: string): string =>
  hashEditableEventContentSnapshot(createEditableEventContentSnapshot({
    description,
    endTime: END,
    isAllDay: false,
    location: "Room 4",
    startTime: START,
    summary: "Quarterly review",
  }));

const importResponse = (description: string) => ({
  body: {
    description,
    end: { dateTime: END.toISOString() },
    iCalUID: "source-event-uid-1@keeper.sh",
    id: "google-event-id",
    location: "Room 4",
    start: { dateTime: START.toISOString() },
    summary: "Quarterly review",
  },
  headers: {},
  statusCode: 200,
});

describe("the stored content hash comes from the response, never from the request", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports the form Google kept when it shortened what was sent", async () => {
    batchMocks.executeBatchChunked.mockResolvedValueOnce([importResponse(STORED_DESCRIPTION)]);

    const [result] = await createProvider().pushEvents([createEvent()]);

    expect(result?.storedContentHash).toBe(hashOfDescription(STORED_DESCRIPTION));
  });

  it("never reports the form that was sent, because that is what churned forever", async () => {
    batchMocks.executeBatchChunked.mockResolvedValueOnce([importResponse(STORED_DESCRIPTION)]);

    const [result] = await createProvider().pushEvents([createEvent()]);

    expect(hashOfDescription(SENT_DESCRIPTION)).not.toBe(hashOfDescription(STORED_DESCRIPTION));
    expect(result?.storedContentHash).not.toBe(hashOfDescription(SENT_DESCRIPTION));
  });

  it("reports the same hash a later read of that event would observe", async () => {
    batchMocks.executeBatchChunked.mockResolvedValueOnce([importResponse(STORED_DESCRIPTION)]);
    const provider = createProvider();

    const [pushed] = await provider.pushEvents([createEvent()]);

    batchMocks.executeBatchChunked.mockResolvedValueOnce([importResponse(STORED_DESCRIPTION)]);
    const [observed] = await provider.getRemoteEventsByIds(["google-event-id"]);

    expect(pushed?.storedContentHash).toBe(observed?.editableContentHash);
  });
});
