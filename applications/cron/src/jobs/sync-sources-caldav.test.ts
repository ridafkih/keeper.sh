import { describe, expect, it } from "bun:test";
import { runCaldavSourceSyncJob } from "./sync-sources-caldav";

describe("runCaldavSourceSyncJob", () => {
  it("publishes metrics for each successful CalDAV provider", async () => {
    const cronEventFieldSets: Record<string, unknown>[] = [];

    await runCaldavSourceSyncJob({
      providers: [
        { id: "caldav", name: "CalDAV" },
        { id: "fastmail", name: "Fastmail" },
      ],
      setCronEventFields: (fields) => {
        cronEventFieldSets.push(fields);
      },
      syncProvider: (provider) => Promise.resolve({
        durationMs: 5,
        eventsAdded: provider.id.length,
        eventsRemoved: provider.id.length + 1,
        outcome: "success",
        providerId: provider.id,
      }),
    });

    expect(cronEventFieldSets).toEqual([
      {
        "events.added": 14,
        "events.removed": 16,
        "provider.count": 2,
        "provider.failed_count": 0,
        "provider.succeeded_count": 2,
      },
    ]);
  });

  it("continues when one provider throws unexpectedly", async () => {
    const cronEventFieldSets: Record<string, unknown>[] = [];

    await runCaldavSourceSyncJob({
      providers: [
        { id: "caldav", name: "CalDAV" },
        { id: "icloud", name: "iCloud" },
      ],
      setCronEventFields: (fields) => {
        cronEventFieldSets.push(fields);
      },
      syncProvider: (provider) => {
        if (provider.id === "caldav") {
          return Promise.reject(new Error("caldav provider exploded"));
        }

        return Promise.resolve({
          durationMs: 5,
          eventsAdded: 3,
          eventsRemoved: 1,
          outcome: "success",
          providerId: provider.id,
        });
      },
    });

    expect(cronEventFieldSets).toEqual([
      {
        "events.added": 3,
        "events.removed": 1,
        "provider.count": 2,
        "provider.failed_count": 1,
        "provider.succeeded_count": 1,
      },
    ]);
  });

  it("continues when one provider throws synchronously", async () => {
    const cronEventFieldSets: Record<string, unknown>[] = [];

    await runCaldavSourceSyncJob({
      providers: [
        { id: "caldav", name: "CalDAV" },
        { id: "icloud", name: "iCloud" },
      ],
      setCronEventFields: (fields) => {
        cronEventFieldSets.push(fields);
      },
      syncProvider: (provider) => {
        if (provider.id === "caldav") {
          throw new Error("sync throw");
        }

        return Promise.resolve({
          durationMs: 4,
          eventsAdded: 2,
          eventsRemoved: 1,
          outcome: "success",
          providerId: provider.id,
        });
      },
    });

    expect(cronEventFieldSets).toEqual([
      {
        "events.added": 2,
        "events.removed": 1,
        "provider.count": 2,
        "provider.failed_count": 1,
        "provider.succeeded_count": 1,
      },
    ]);
  });

  it("does not emit metrics for null provider results", async () => {
    const cronEventFieldSets: Record<string, unknown>[] = [];

    await runCaldavSourceSyncJob({
      providers: [{ id: "caldav", name: "CalDAV" }],
      setCronEventFields: (fields) => {
        cronEventFieldSets.push(fields);
      },
      syncProvider: () => Promise.resolve(null),
    });

    expect(cronEventFieldSets).toEqual([
      {
        "events.added": 0,
        "events.removed": 0,
        "provider.count": 1,
        "provider.failed_count": 1,
        "provider.succeeded_count": 0,
      },
    ]);
  });

  it("completes without throwing when multiple providers reject", async () => {
    await runCaldavSourceSyncJob({
      providers: [
        { id: "caldav", name: "CalDAV" },
        { id: "icloud", name: "iCloud" },
      ],
      setCronEventFields: Boolean,
      syncProvider: () => Promise.reject(new Error("provider failure")),
    });
  });
});
