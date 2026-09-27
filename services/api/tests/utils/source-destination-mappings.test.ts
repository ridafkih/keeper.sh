import { describe, expect, it } from "vitest";
import {
  type MappingMutationSyncLock,
  runWithMappingMutationLocks,
} from "../../src/utils/source-destination-mappings";

describe("runWithMappingMutationLocks", () => {
  it("waits for destination reconciliation locks before mutating mappings", async () => {
    const operationLog: string[] = [];
    const activeReconciliation = Promise.withResolvers<null>();
    const createHandle = (calendarId: string) => ({
      isHeld: () => Promise.resolve(true),
      isCurrent: () => Promise.resolve(true),
      release: () => {
        operationLog.push(`release:${calendarId}`);
        return Promise.resolve();
      },
    });
    const syncLock: MappingMutationSyncLock = {
      acquire: async (calendarId) => {
        operationLog.push(`acquire:${calendarId}`);
        if (calendarId === "destination-a") {
          await activeReconciliation.promise;
        }
        return { acquired: true, handle: createHandle(calendarId) };
      },
    };

    const mutation = runWithMappingMutationLocks(
      syncLock,
      "user-1",
      () => {
        operationLog.push("resolve-destinations");
        return Promise.resolve(["destination-b", "destination-a", "destination-b"]);
      },
      () => {
        operationLog.push("mutate");
        return Promise.resolve("done");
      },
    );

    await Promise.resolve();
    await Promise.resolve();
    expect(operationLog).not.toContain("mutate");

    activeReconciliation.resolve(null);
    await expect(mutation).resolves.toEqual({
      destinationCalendarIds: ["destination-a", "destination-b"],
      result: "done",
    });
    expect(operationLog).toEqual([
      "acquire:mapping-mutation:user-1",
      "resolve-destinations",
      "acquire:destination-a",
      "acquire:destination-b",
      "mutate",
      "release:destination-b",
      "release:destination-a",
      "release:mapping-mutation:user-1",
    ]);
  });

  it("does not mutate after any destination lock loses ownership", async () => {
    let mutateCalled = false;
    const syncLock: MappingMutationSyncLock = {
      acquire: (calendarId) => Promise.resolve({
        acquired: true,
        handle: {
          isCurrent: () => Promise.resolve(true),
          isHeld: () => Promise.resolve(calendarId !== "destination-a"),
          release: () => Promise.resolve(),
        },
      }),
    };

    await expect(runWithMappingMutationLocks(
      syncLock,
      "user-1",
      () => Promise.resolve(["destination-a"]),
      () => {
        mutateCalled = true;
        return Promise.resolve();
      },
    )).rejects.toThrow("lost its reconciliation lock");

    expect(mutateCalled).toBe(false);
  });

  it("releases every handle when one Redis release fails", async () => {
    const released: string[] = [];
    const syncLock: MappingMutationSyncLock = {
      acquire: (calendarId) => Promise.resolve({
        acquired: true,
        handle: {
          isCurrent: () => Promise.resolve(true),
          isHeld: () => Promise.resolve(true),
          release: () => {
            released.push(calendarId);
            if (calendarId === "destination-b") {
              return Promise.reject(new Error("redis unavailable"));
            }
            return Promise.resolve();
          },
        },
      }),
    };

    await expect(runWithMappingMutationLocks(
      syncLock,
      "user-1",
      () => Promise.resolve(["destination-a", "destination-b"]),
      () => Promise.resolve(),
    )).rejects.toThrow("Failed to release mapping mutation locks");

    expect(released).toEqual([
      "destination-b",
      "destination-a",
      "mapping-mutation:user-1",
    ]);
  });
});
