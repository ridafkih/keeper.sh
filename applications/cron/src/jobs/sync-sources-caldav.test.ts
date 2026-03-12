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
        eventsAdded: provider.id.length,
        eventsRemoved: provider.id.length + 1,
        providerId: provider.id,
      }),
    });

    expect(cronEventFieldSets).toEqual([
      {
        "caldav.events.added": 6,
        "caldav.events.removed": 7,
      },
      {
        "fastmail.events.added": 8,
        "fastmail.events.removed": 9,
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
          eventsAdded: 3,
          eventsRemoved: 1,
          providerId: provider.id,
        });
      },
    });

    expect(cronEventFieldSets).toEqual([
      {
        "icloud.events.added": 3,
        "icloud.events.removed": 1,
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
          eventsAdded: 2,
          eventsRemoved: 1,
          providerId: provider.id,
        });
      },
    });

    expect(cronEventFieldSets).toEqual([
      {
        "icloud.events.added": 2,
        "icloud.events.removed": 1,
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

    expect(cronEventFieldSets).toEqual([]);
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
