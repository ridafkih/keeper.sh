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
        "google.error.count": 1,
        "google.error.messages": ["calendar timeout"],
        "google.error.Error.count": 1,
        "google.error.Error.messages": ["calendar timeout"],
        "google.events.added": 7,
        "google.events.removed": 2,
      },
      {
        "outlook.error.count": 0,
        "outlook.events.added": 4,
        "outlook.events.removed": 3,
      },
    ]);
  });

  it("continues when one provider fails unexpectedly", async () => {
    const cronEventFieldSets: Record<string, unknown>[] = [];
    const errors: unknown[] = [];

    await runOAuthSourceSyncJob({
      reportError: (error) => {
        errors.push(error);
      },
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

    expect(errors).toHaveLength(1);
    expect(cronEventFieldSets).toEqual([
      {
        "outlook.error.count": 2,
        "outlook.error.messages": ["outlook source failed"],
        "outlook.error.AuthError.count": 2,
        "outlook.error.AuthError.messages": ["outlook source failed"],
        "outlook.events.added": 1,
        "outlook.events.removed": 5,
      },
    ]);
  });

  it("continues when one provider throws synchronously", async () => {
    const cronEventFieldSets: Record<string, unknown>[] = [];
    const errors: unknown[] = [];

    await runOAuthSourceSyncJob({
      reportError: (error) => {
        errors.push(error);
      },
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

    expect(errors).toHaveLength(1);
    expect(cronEventFieldSets).toEqual([
      {
        "outlook.error.count": 0,
        "outlook.events.added": 9,
        "outlook.events.removed": 4,
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
        "outlook.error.count": 0,
        "outlook.events.added": 2,
        "outlook.events.removed": 2,
      },
    ]);
  });

  it("reports each provider rejection when both providers throw", async () => {
    const errors: unknown[] = [];

    await runOAuthSourceSyncJob({
      reportError: (error) => {
        errors.push(error);
      },
      setCronEventFields: Boolean,
      syncGoogleSources: () => Promise.reject(new Error("google crashed")),
      syncOutlookSources: () => Promise.reject(new Error("outlook crashed")),
    });

    expect(errors).toHaveLength(2);
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
        "google.error.count": 0,
        "google.events.added": 3,
        "google.events.removed": 1,
      },
    ]);
  });
});
