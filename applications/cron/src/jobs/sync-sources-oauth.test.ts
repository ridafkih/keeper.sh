import { describe, expect, it } from "bun:test";
import { runOAuthSourceSyncJob } from "./sync-sources-oauth";

describe("runOAuthSourceSyncJob", () => {
  it("publishes provider metrics for successful sync results", async () => {
    const cronEventFieldSets: Record<string, unknown>[] = [];

    await runOAuthSourceSyncJob({
      setCronEventFields: (fields) => {
        cronEventFieldSets.push(fields);
      },
      syncGoogleSources: () => Promise.resolve({
        errorCount: 1,
        errorDetails: { Error: { count: 1, messages: ["calendar timeout"] } },
        errorMessages: ["calendar timeout"],
        eventsAdded: 7,
        eventsRemoved: 2,
      }),
      syncOutlookSources: () => Promise.resolve({
        errorCount: 0,
        errorDetails: {},
        errorMessages: [],
        eventsAdded: 4,
        eventsRemoved: 3,
      }),
    });

    expect(cronEventFieldSets).toEqual([
      {
        "events.added": 11,
        "events.filtered_out_of_window": 0,
        "events.inserted": 0,
        "events.removed": 5,
        "events.updated": 0,
        "provider.count": 2,
        "provider.error_count": 1,
        "provider.failed_count": 0,
        "provider.succeeded_count": 2,
        "sync_token.reset_count": 0,
      },
    ]);
  });

  it("continues when one provider fails unexpectedly", async () => {
    const cronEventFieldSets: Record<string, unknown>[] = [];

    await runOAuthSourceSyncJob({
      setCronEventFields: (fields) => {
        cronEventFieldSets.push(fields);
      },
      syncGoogleSources: () => Promise.reject(new Error("google failed")),
      syncOutlookSources: () => Promise.resolve({
        errorCount: 2,
        errorDetails: {
          AuthError: {
            count: 2,
            messages: ["outlook source failed", "outlook source failed"],
          },
        },
        errorMessages: ["outlook source failed", "outlook source failed"],
        eventsAdded: 1,
        eventsRemoved: 5,
      }),
    });

    expect(cronEventFieldSets).toEqual([
      {
        "events.added": 1,
        "events.filtered_out_of_window": 0,
        "events.inserted": 0,
        "events.removed": 5,
        "events.updated": 0,
        "provider.count": 2,
        "provider.error_count": 2,
        "provider.failed_count": 1,
        "provider.succeeded_count": 1,
        "sync_token.reset_count": 0,
      },
    ]);
  });

  it("continues when one provider throws synchronously", async () => {
    const cronEventFieldSets: Record<string, unknown>[] = [];

    await runOAuthSourceSyncJob({
      setCronEventFields: (fields) => {
        cronEventFieldSets.push(fields);
      },
      syncGoogleSources: () => {
        throw new Error("google sync throw");
      },
      syncOutlookSources: () => Promise.resolve({
        errorCount: 0,
        errorDetails: {},
        errorMessages: [],
        eventsAdded: 9,
        eventsRemoved: 4,
      }),
    });

    expect(cronEventFieldSets).toEqual([
      {
        "events.added": 9,
        "events.filtered_out_of_window": 0,
        "events.inserted": 0,
        "events.removed": 4,
        "events.updated": 0,
        "provider.count": 2,
        "provider.error_count": 0,
        "provider.failed_count": 1,
        "provider.succeeded_count": 1,
        "sync_token.reset_count": 0,
      },
    ]);
  });

  it("skips metric emission for providers that return null", async () => {
    const cronEventFieldSets: Record<string, unknown>[] = [];

    await runOAuthSourceSyncJob({
      setCronEventFields: (fields) => {
        cronEventFieldSets.push(fields);
      },
      syncGoogleSources: () => Promise.resolve(null),
      syncOutlookSources: () => Promise.resolve({
        errorCount: 0,
        errorDetails: {},
        errorMessages: [],
        eventsAdded: 2,
        eventsRemoved: 2,
      }),
    });

    expect(cronEventFieldSets).toEqual([
      {
        "events.added": 2,
        "events.filtered_out_of_window": 0,
        "events.inserted": 0,
        "events.removed": 2,
        "events.updated": 0,
        "provider.count": 2,
        "provider.error_count": 0,
        "provider.failed_count": 1,
        "provider.succeeded_count": 1,
        "sync_token.reset_count": 0,
      },
    ]);
  });

  it("completes without throwing when both providers reject", async () => {
    await runOAuthSourceSyncJob({
      setCronEventFields: Boolean,
      syncGoogleSources: () => Promise.reject(new Error("google crashed")),
      syncOutlookSources: () => Promise.reject(new Error("outlook crashed")),
    });
  });

  it("omits provider error detail fields when there are no embedded provider errors", async () => {
    const cronEventFieldSets: Record<string, unknown>[] = [];

    await runOAuthSourceSyncJob({
      setCronEventFields: (fields) => {
        cronEventFieldSets.push(fields);
      },
      syncGoogleSources: () => Promise.resolve({
        errorCount: 0,
        errorDetails: {},
        errorMessages: [],
        eventsAdded: 3,
        eventsRemoved: 1,
      }),
      syncOutlookSources: () => Promise.resolve(null),
    });

    expect(cronEventFieldSets).toEqual([
      {
        "events.added": 3,
        "events.filtered_out_of_window": 0,
        "events.inserted": 0,
        "events.removed": 1,
        "events.updated": 0,
        "provider.count": 2,
        "provider.error_count": 0,
        "provider.failed_count": 1,
        "provider.succeeded_count": 1,
        "sync_token.reset_count": 0,
      },
    ]);
  });
});
