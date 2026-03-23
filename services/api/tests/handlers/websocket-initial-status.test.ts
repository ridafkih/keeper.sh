import { describe, expect, it } from "bun:test";
import {
  runSendInitialSyncStatus,
  type OutgoingSyncAggregatePayload,
} from "../../src/handlers/websocket-initial-status";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const readSentPayload = (sentMessages: string[]): Record<string, unknown> => {
  const [sentMessage] = sentMessages;
  if (!sentMessage) {
    throw new Error("Expected a websocket message");
  }

  const parsed: unknown = JSON.parse(sentMessage);
  if (!isRecord(parsed)) {
    throw new Error("Expected JSON object payload");
  }

  return parsed;
};

describe("runSendInitialSyncStatus", () => {
  it("sends resolved aggregate payload when resolver returns valid data", async () => {
    const sentMessages: string[] = [];
    const expectedPayload: OutgoingSyncAggregatePayload = {
      lastSyncedAt: "2026-03-08T12:00:00.000Z",
      progressPercent: 70,
      seq: 5,
      syncEventsProcessed: 7,
      syncEventsRemaining: 3,
      syncEventsTotal: 10,
      syncing: true,
    };

    await runSendInitialSyncStatus(
      "user-1",
      {
        send: (message) => {
          sentMessages.push(message);
        },
      },
      {
        isValidSyncAggregate: (value): value is OutgoingSyncAggregatePayload =>
          Boolean(
            value &&
            typeof value === "object" &&
            "seq" in value &&
            typeof value.seq === "number",
          ),
        resolveSyncAggregatePayload: () => Promise.resolve(expectedPayload),
        selectLatestDestinationSyncedAt: () =>
          Promise.resolve(new Date("2026-03-08T11:59:00.000Z")),
      },
    );

    const sent = readSentPayload(sentMessages);
    expect(sent.event).toBe("sync:aggregate");
    expect(sent.data).toEqual(expectedPayload);
  });

  it("throws when resolver fails and sends nothing", () => {
    const sentMessages: string[] = [];

    expect(
      runSendInitialSyncStatus(
        "user-1",
        {
          send: (message) => {
            sentMessages.push(message);
          },
        },
        {
          isValidSyncAggregate: (_value): _value is OutgoingSyncAggregatePayload => false,
          resolveSyncAggregatePayload: () =>
            Promise.reject(new Error("resolver failed")),
          selectLatestDestinationSyncedAt: () =>
            Promise.resolve(new Date("2026-03-08T11:59:00.000Z")),
        },
      ),
    ).rejects.toThrow("resolver failed");

    expect(sentMessages).toHaveLength(0);
  });

  it("throws when resolved payload is invalid and sends nothing", () => {
    const sentMessages: string[] = [];

    expect(
      runSendInitialSyncStatus(
        "user-1",
        {
          send: (message) => {
            sentMessages.push(message);
          },
        },
        {
          isValidSyncAggregate: (_value): _value is OutgoingSyncAggregatePayload => false,
          resolveSyncAggregatePayload: () => Promise.resolve({
            progressPercent: 100,
            syncEventsProcessed: 0,
            syncEventsRemaining: 0,
            syncEventsTotal: 0,
          }),
          selectLatestDestinationSyncedAt: () => Promise.resolve(null),
        },
      ),
    ).rejects.toThrow("Invalid initial sync aggregate payload");

    expect(sentMessages).toHaveLength(0);
  });

  it("throws when synced-at query fails and sends nothing", () => {
    const sentMessages: string[] = [];

    expect(
      runSendInitialSyncStatus(
        "user-1",
        {
          send: (message) => {
            sentMessages.push(message);
          },
        },
        {
          isValidSyncAggregate: (_value): _value is OutgoingSyncAggregatePayload => false,
          resolveSyncAggregatePayload: () =>
            Promise.reject(new Error("resolver failed")),
          selectLatestDestinationSyncedAt: () =>
            Promise.reject(new Error("query failed")),
        },
      ),
    ).rejects.toThrow("query failed");

    expect(sentMessages).toHaveLength(0);
  });
});
