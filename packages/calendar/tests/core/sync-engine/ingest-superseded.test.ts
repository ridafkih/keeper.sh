import { describe, expect, it, vi } from "vitest";
import { ingestSource } from "../../../src/core/sync-engine/ingest";
import type { IngestionChanges } from "../../../src/core/sync-engine/ingest";
import type { SourceEvent } from "../../../src/core/types";

const sourceEvent: SourceEvent = {
  endTime: new Date("2026-08-12T11:00:00.000Z"),
  startTime: new Date("2026-08-12T10:00:00.000Z"),
  title: "Standup",
  uid: "event-1",
};

const runIngest = async (isCurrentSequence: boolean[]) => {
  const flush = vi.fn((_changes: IngestionChanges) => Promise.resolve());
  const readExistingEvents = vi.fn(() => Promise.resolve([]));
  const wideEvents: Record<string, unknown>[] = [];
  const answers = [...isCurrentSequence];

  const result = await ingestSource({
    calendarId: "cal-1",
    fetchEvents: () => Promise.resolve({
      events: [sourceEvent],
      isDeltaSync: true,
      nextSyncToken: "next-token",
    }),
    flush,
    isCurrent: () => Promise.resolve(answers.shift() ?? true),
    onIngestEvent: (event) => {
      wideEvents.push(event);
    },
    readExistingEvents,
  });

  return { flush, readExistingEvents, result, wideEvents };
};

describe("ingestSource supersession", () => {
  it("discards the fetch without flushing when a waiter supersedes the holder", async () => {
    const { flush, readExistingEvents, result, wideEvents } = await runIngest([false]);

    expect(result).toEqual({ eventsAdded: 0, eventsRemoved: 0 });
    expect(flush).not.toHaveBeenCalled();
    expect(readExistingEvents).not.toHaveBeenCalled();
    expect(wideEvents[0]).toMatchObject({ flushed: false, outcome: "superseded" });
  });

  it("never writes a sync token on the superseded path", async () => {
    const { flush } = await runIngest([false]);

    const flushedTokens = flush.mock.calls.map(([changes]) => changes);
    expect(flushedTokens).toEqual([]);
  });

  it("still flushes and persists the sync token when nothing supersedes it", async () => {
    const { flush, wideEvents } = await runIngest([true]);

    expect(flush).toHaveBeenCalledOnce();
    expect(flush.mock.calls[0]?.[0]).toMatchObject({ syncToken: "next-token" });
    expect(wideEvents[0]).toMatchObject({ flushed: true, outcome: "success" });
  });
});
