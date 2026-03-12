import { describe, expect, it } from "bun:test";
import { runDestinationSyncTrigger } from "./sync";

const missingSyncCallback = (): Promise<Record<string, number>> =>
  Promise.reject(new Error("Expected background callback"));

describe("runDestinationSyncTrigger", () => {
  it("spawns background destination sync with mapped result fields", async () => {
    const spawnedJobs: { name: string; userId: unknown }[] = [];
    let capturedCallback: () => Promise<Record<string, number>> = missingSyncCallback;

    runDestinationSyncTrigger("user-1", {
      spawnBackgroundJob: (name, fields, callback) => {
        spawnedJobs.push({ name, userId: fields.userId });
        capturedCallback = callback;
      },
      syncDestinationsForUser: () => Promise.resolve({
        addFailed: 2,
        added: 7,
        removeFailed: 1,
        removed: 3,
      }),
    });

    expect(spawnedJobs).toEqual([{ name: "destination-sync", userId: "user-1" }]);
    expect(capturedCallback).not.toBe(missingSyncCallback);

    const backgroundResult = await capturedCallback();
    expect(backgroundResult).toEqual({
      eventsAddFailed: 2,
      eventsAdded: 7,
      eventsRemoveFailed: 1,
      eventsRemoved: 3,
    });
  });

  it("surfaces sync failures through the background callback", () => {
    let capturedCallback: () => Promise<Record<string, number>> = missingSyncCallback;
    const expectedError = new Error("sync failed");

    runDestinationSyncTrigger("user-2", {
      spawnBackgroundJob: (_name, _fields, callback) => {
        capturedCallback = callback;
      },
      syncDestinationsForUser: () => Promise.reject(expectedError),
    });

    expect(capturedCallback).not.toBe(missingSyncCallback);
    expect(capturedCallback()).rejects.toBe(expectedError);
  });

  it("passes the same userId through to destination sync execution", async () => {
    const receivedUserIds: string[] = [];
    let capturedCallback: () => Promise<Record<string, number>> = missingSyncCallback;

    runDestinationSyncTrigger("user-3", {
      spawnBackgroundJob: (_name, _fields, callback) => {
        capturedCallback = callback;
      },
      syncDestinationsForUser: (userId) => {
        receivedUserIds.push(userId);
        return Promise.resolve({
          addFailed: 0,
          added: 1,
          removeFailed: 0,
          removed: 1,
        });
      },
    });

    expect(capturedCallback).not.toBe(missingSyncCallback);
    await capturedCallback();
    expect(receivedUserIds).toEqual(["user-3"]);
  });
});
