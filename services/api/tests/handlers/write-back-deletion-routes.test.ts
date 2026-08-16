import { describe, expect, it } from "vitest";

import { handleGetWriteBackDeletionsRoute } from "../../src/handlers/write-back-deletion-routes";
import type { WriteBackDeletionRecord } from "../../src/queries/list-write-back-deletions";

const NOW = new Date("2026-08-15T12:00:00.000Z");

const record: WriteBackDeletionRecord = {
  confirmed: true,
  deletedAt: "2026-08-14T09:00:00.000Z",
  description: null,
  destinationCalendarName: "Work",
  endTime: "2026-08-01T10:30:00.000Z",
  expiresAt: "2026-09-13T09:00:00.000Z",
  id: "tombstone-1",
  isAllDay: false,
  location: null,
  sourceCalendarName: "Personal",
  startTime: "2026-08-01T10:00:00.000Z",
  startTimeZone: "Europe/London",
  title: "Standup",
};

describe("the endpoint behind the record of deleted events", () => {
  it("answers with the signed-in user's deletions", async () => {
    const asked: { now: Date; userId: string }[] = [];
    const response = await handleGetWriteBackDeletionsRoute(
      { userId: "user-1" },
      {
        listWriteBackDeletions: (userId, now) => {
          asked.push({ now, userId });
          return Promise.resolve({ deletions: [record], truncated: false });
        },
        now: () => NOW,
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deletions: [record], truncated: false });
    expect(asked).toEqual([{ now: NOW, userId: "user-1" }]);
  });

  it("answers with an empty record rather than an error when nothing was deleted", async () => {
    const response = await handleGetWriteBackDeletionsRoute(
      { userId: "user-1" },
      {
        listWriteBackDeletions: () => Promise.resolve({ deletions: [], truncated: false }),
        now: () => NOW,
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deletions: [], truncated: false });
  });

  it("tells the page when the record it answered with had to stop short", async () => {
    const response = await handleGetWriteBackDeletionsRoute(
      { userId: "user-1" },
      {
        listWriteBackDeletions: () => Promise.resolve({ deletions: [record], truncated: true }),
        now: () => NOW,
      },
    );

    expect(await response.json()).toEqual({ deletions: [record], truncated: true });
  });
});
