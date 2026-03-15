import { describe, expect, it } from "bun:test";
import { runIcalSnapshotSyncJob } from "./sync-sources-ical";

describe("runIcalSnapshotSyncJob", () => {
  it("continues processing when one source is missing URL", async () => {
    const cronEventFieldSets: Record<string, unknown>[] = [];
    const fetchedSources: { calendarId: string; url: string }[] = [];
    const processedSnapshots: { calendarId: string; ical: string }[] = [];

    await runIcalSnapshotSyncJob({
      fetchRemoteCalendar: (calendarId, url) => {
        fetchedSources.push({ calendarId, url });
        return Promise.resolve({ calendarId, ical: `ICAL:${calendarId}` });
      },
      getRemoteSources: () => Promise.resolve([
        { id: "source-missing-url", url: null },
        { id: "source-valid", url: "https://example.com/valid.ics" },
      ]),
      processSnapshot: (calendarId, ical) => {
        processedSnapshots.push({ calendarId, ical });
        return Promise.resolve({ error: false, skipped: false });
      },
      setCronEventFields: (fields) => {
        cronEventFieldSets.push(fields);
      },
    });

    expect(fetchedSources).toEqual([
      { calendarId: "source-valid", url: "https://example.com/valid.ics" },
    ]);
    expect(processedSnapshots).toEqual([
      { calendarId: "source-valid", ical: "ICAL:source-valid" },
    ]);
    expect(cronEventFieldSets).toEqual([
      { "source.count": 2 },
      { "fetch.failed.count": 1, "fetch.succeeded.count": 1 },
      { "insert.count": 1, "insert.error.count": 0, "skipped.count": 0 },
    ]);
  });

  it("continues processing when one remote fetch rejects", async () => {
    const processedSnapshots: { calendarId: string; ical: string }[] = [];

    await runIcalSnapshotSyncJob({
      fetchRemoteCalendar: (calendarId) => {
        if (calendarId === "source-failing-fetch") {
          return Promise.reject(new Error("fetch exploded"));
        }
        return Promise.resolve({ calendarId, ical: `ICAL:${calendarId}` });
      },
      getRemoteSources: () => Promise.resolve([
        { id: "source-failing-fetch", url: "https://example.com/fail.ics" },
        { id: "source-success", url: "https://example.com/success.ics" },
      ]),
      processSnapshot: (calendarId, ical) => {
        processedSnapshots.push({ calendarId, ical });
        return Promise.resolve({ error: false, skipped: false });
      },
      setCronEventFields: Boolean,
    });

    expect(processedSnapshots).toEqual([
      { calendarId: "source-success", ical: "ICAL:source-success" },
    ]);
  });

  it("continues processing when one remote fetch throws synchronously", async () => {
    const processedSnapshots: { calendarId: string; ical: string }[] = [];
    const cronEventFieldSets: Record<string, unknown>[] = [];

    await runIcalSnapshotSyncJob({
      fetchRemoteCalendar: (calendarId) => {
        if (calendarId === "source-throw-sync") {
          throw new Error("sync fetch throw");
        }

        return Promise.resolve({ calendarId, ical: `ICAL:${calendarId}` });
      },
      getRemoteSources: () => Promise.resolve([
        { id: "source-throw-sync", url: "https://example.com/fail-sync.ics" },
        { id: "source-survives", url: "https://example.com/survives.ics" },
      ]),
      processSnapshot: (calendarId, ical) => {
        processedSnapshots.push({ calendarId, ical });
        return Promise.resolve({ error: false, skipped: false });
      },
      setCronEventFields: (fields) => {
        cronEventFieldSets.push(fields);
      },
    });

    expect(processedSnapshots).toEqual([
      { calendarId: "source-survives", ical: "ICAL:source-survives" },
    ]);
    expect(cronEventFieldSets[1]).toEqual({
      "fetch.failed.count": 1,
      "fetch.succeeded.count": 1,
    });
  });

  it("reports insert, skipped, and insert-error counts from snapshot processing", async () => {
    const cronEventFieldSets: Record<string, unknown>[] = [];

    await runIcalSnapshotSyncJob({
      fetchRemoteCalendar: (calendarId) => Promise.resolve({ calendarId, ical: `ICAL:${calendarId}` }),
      getRemoteSources: () => Promise.resolve([
        { id: "source-inserted", url: "https://example.com/one.ics" },
        { id: "source-skipped", url: "https://example.com/two.ics" },
        { id: "source-error", url: "https://example.com/three.ics" },
      ]),
      processSnapshot: (calendarId) => {
        if (calendarId === "source-skipped") {
          return Promise.resolve({ error: false, skipped: true });
        }
        if (calendarId === "source-error") {
          return Promise.resolve({ error: true, skipped: false });
        }
        return Promise.resolve({ error: false, skipped: false });
      },
      setCronEventFields: (fields) => {
        cronEventFieldSets.push(fields);
      },
    });

    expect(cronEventFieldSets[2]).toEqual({
      "insert.count": 1,
      "insert.error.count": 1,
      "skipped.count": 1,
    });
  });

  it("continues when one snapshot processing task throws unexpectedly", async () => {
    const cronEventFieldSets: Record<string, unknown>[] = [];
    const processedSnapshotIds: string[] = [];

    await runIcalSnapshotSyncJob({
      fetchRemoteCalendar: (calendarId) => Promise.resolve({ calendarId, ical: `ICAL:${calendarId}` }),
      getRemoteSources: () => Promise.resolve([
        { id: "source-throwing", url: "https://example.com/throw.ics" },
        { id: "source-stable", url: "https://example.com/stable.ics" },
      ]),
      processSnapshot: (calendarId) => {
        processedSnapshotIds.push(calendarId);
        if (calendarId === "source-throwing") {
          return Promise.reject(new Error("snapshot processor exploded"));
        }
        return Promise.resolve({ error: false, skipped: false });
      },
      setCronEventFields: (fields) => {
        cronEventFieldSets.push(fields);
      },
    });

    expect(processedSnapshotIds).toEqual(["source-throwing", "source-stable"]);
    expect(cronEventFieldSets[2]).toEqual({
      "insert.count": 1,
      "insert.error.count": 1,
      "skipped.count": 0,
    });
  });

  it("continues when one snapshot processor throws synchronously", async () => {
    const cronEventFieldSets: Record<string, unknown>[] = [];

    await runIcalSnapshotSyncJob({
      fetchRemoteCalendar: (calendarId) =>
        Promise.resolve({ calendarId, ical: `ICAL:${calendarId}` }),
      getRemoteSources: () => Promise.resolve([
        { id: "source-throw-sync", url: "https://example.com/throw-sync.ics" },
        { id: "source-stable", url: "https://example.com/stable.ics" },
      ]),
      processSnapshot: (calendarId) => {
        if (calendarId === "source-throw-sync") {
          throw new Error("sync processor throw");
        }

        return Promise.resolve({ error: false, skipped: false });
      },
      setCronEventFields: (fields) => {
        cronEventFieldSets.push(fields);
      },
    });

    expect(cronEventFieldSets[2]).toEqual({
      "insert.count": 1,
      "insert.error.count": 1,
      "skipped.count": 0,
    });
  });

  it("aggregates high-volume mixed outcomes correctly", async () => {
    const sourceCount = 120;
    const remoteSources = Array.from({ length: sourceCount }, (_value, index) => {
      const source: { id: string; url: string | null } = {
        id: `source-${index}`,
        url: `https://example.com/${index}.ics`,
      };
      if (index % 10 === 0) {
        source.url = null;
      }
      return source;
    });

    let fetchFailedCount = 0;
    let fetchSucceededCount = 0;
    let expectedInsertedCount = 0;
    let expectedSkippedCount = 0;
    let expectedInsertErrorCount = 0;
    for (const source of remoteSources) {
      const index = Number(source.id.replace("source-", ""));
      const hasMissingUrl = source.url === null;
      const fetchThrows = !hasMissingUrl && index % 15 === 0;
      if (hasMissingUrl || fetchThrows) {
        fetchFailedCount += 1;
        continue;
      }

      fetchSucceededCount += 1;

      if (index % 7 === 0) {
        expectedInsertErrorCount += 1;
      } else if (index % 5 === 0) {
        expectedInsertErrorCount += 1;
      } else if (index % 3 === 0) {
        expectedSkippedCount += 1;
      } else {
        expectedInsertedCount += 1;
      }
    }

    const cronEventFieldSets: Record<string, unknown>[] = [];

    await runIcalSnapshotSyncJob({
      fetchRemoteCalendar: (calendarId) => {
        const index = Number(calendarId.replace("source-", ""));
        if (index % 15 === 0) {
          return Promise.reject(new Error(`fetch failure ${index}`));
        }
        return Promise.resolve({ calendarId, ical: `ICAL:${calendarId}` });
      },
      getRemoteSources: () => Promise.resolve(remoteSources),
      processSnapshot: (calendarId) => {
        const index = Number(calendarId.replace("source-", ""));
        if (index % 7 === 0) {
          return Promise.reject(new Error(`processor failure ${index}`));
        }
        if (index % 5 === 0) {
          return Promise.resolve({ error: true, skipped: false });
        }
        if (index % 3 === 0) {
          return Promise.resolve({ error: false, skipped: true });
        }
        return Promise.resolve({ error: false, skipped: false });
      },
      setCronEventFields: (fields) => {
        cronEventFieldSets.push(fields);
      },
    });

    expect(cronEventFieldSets[0]).toEqual({ "source.count": sourceCount });
    expect(cronEventFieldSets[1]).toEqual({
      "fetch.failed.count": fetchFailedCount,
      "fetch.succeeded.count": fetchSucceededCount,
    });
    expect(cronEventFieldSets[2]).toEqual({
      "insert.count": expectedInsertedCount,
      "insert.error.count": expectedInsertErrorCount,
      "skipped.count": expectedSkippedCount,
    });
  });
});
