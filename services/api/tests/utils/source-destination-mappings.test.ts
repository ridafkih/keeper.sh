import { describe, expect, it } from "vitest";
import {
  type MappingMutationSyncLock,
  runSetDestinationsForSource,
  runSetSourcesForDestination,
  runWithMappingMutationLocks,
} from "../../src/utils/source-destination-mappings";

const createMappingKey = (sourceCalendarId: string, destinationCalendarId: string): string =>
  `${sourceCalendarId}::${destinationCalendarId}`;

const parseMappingKey = (
  mappingKey: string,
): { sourceCalendarId: string; destinationCalendarId: string } => {
  const [sourceCalendarId, destinationCalendarId] = mappingKey.split("::");
  if (!sourceCalendarId || !destinationCalendarId) {
    throw new Error("Invalid mapping key");
  }

  return { destinationCalendarId, sourceCalendarId };
};

const collectDestinationIds = (
  mappings: Set<string>,
  sourceCalendarId: string,
): string[] => {
  const destinationIds: string[] = [];
  for (const mappingKey of mappings) {
    const mapping = parseMappingKey(mappingKey);
    if (mapping.sourceCalendarId === sourceCalendarId) {
      destinationIds.push(mapping.destinationCalendarId);
    }
  }

  return destinationIds.toSorted();
};

const collectSourceIds = (
  mappings: Set<string>,
  destinationCalendarId: string,
): string[] => {
  const sourceIds: string[] = [];
  for (const mappingKey of mappings) {
    const mapping = parseMappingKey(mappingKey);
    if (mapping.destinationCalendarId === destinationCalendarId) {
      sourceIds.push(mapping.sourceCalendarId);
    }
  }

  return sourceIds.toSorted();
};

interface UserLockManager {
  acquire: (userId: string) => Promise<() => void>;
}

const releaseLockNoop = (): void => {
  Number.isFinite(0);
};

const createUserLockManager = (): UserLockManager => {
  const lockQueueByUserId = new Map<string, Promise<unknown>>();

  return {
    acquire: async (userId) => {
      const previousLock = lockQueueByUserId.get(userId) ?? Promise.resolve();

      const lockResolver = Promise.withResolvers<null>();
      const currentLock = lockResolver.promise;

      lockQueueByUserId.set(userId, previousLock.then(() => currentLock));
      await previousLock;

      return () => {
        lockResolver.resolve(null);
      };
    },
  };
};

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

describe("runSetDestinationsForSource", () => {
  it("throws when source calendar is not found and does not trigger sync", () => {
    expect(
      runSetDestinationsForSource("user-1", "source-1", ["dest-1"], {
        withTransaction: (transactionCallback) =>
          transactionCallback({
            acquireUserLock: () => Promise.resolve(),
            deleteSourceMappings: () => Promise.resolve(),
            ensureDestinationSyncStatuses: () => Promise.resolve(),
            findExistingDestinationIds: () => Promise.resolve([]),
            findOwnedDestinationIds: () => Promise.resolve(["dest-1"]),
            insertSourceMappings: () => Promise.resolve(),
            sourceExists: () => Promise.resolve(false),
          }),
      }),
    ).rejects.toThrow("Source calendar not found");


  });

  it("throws when destination calendars include invalid IDs", () => {
    expect(
      runSetDestinationsForSource("user-1", "source-1", ["dest-1", "dest-2"], {
        withTransaction: (transactionCallback) =>
          transactionCallback({
            acquireUserLock: () => Promise.resolve(),
            deleteSourceMappings: () => Promise.resolve(),
            ensureDestinationSyncStatuses: () => Promise.resolve(),
            findExistingDestinationIds: () => Promise.resolve([]),
            findOwnedDestinationIds: () => Promise.resolve(["dest-1"]),
            insertSourceMappings: () => Promise.resolve(),
            sourceExists: () => Promise.resolve(true),
          }),
      }),
    ).rejects.toThrow("Some destination calendars not found");
  });

  it("replaces mappings, ensures statuses, and triggers sync on success", async () => {
    const operationLog: string[] = [];

    await runSetDestinationsForSource("user-1", "source-1", ["dest-1", "dest-2"], {
      withTransaction: (transactionCallback) =>
        transactionCallback({
          acquireUserLock: (userId) => {
            operationLog.push(`lock:${userId}`);
            return Promise.resolve();
          },
          ensureDestinationSyncStatuses: (destinationIds) => {
            operationLog.push(`status:${destinationIds.join(",")}`);
            return Promise.resolve();
          },
          deleteSourceMappings: (_sourceCalendarId, destinationIds) => {
            operationLog.push(`delete:${destinationIds.join(",")}`);
            return Promise.resolve();
          },
          findExistingDestinationIds: () => Promise.resolve(["dest-1"]),
          findOwnedDestinationIds: () => Promise.resolve(["dest-1", "dest-2"]),
          insertSourceMappings: (_sourceCalendarId, destinationIds) => {
            operationLog.push(`insert:${destinationIds.join(",")}`);
            return Promise.resolve();
          },
          requestUserSync: (userId) => {
            operationLog.push(`request:${userId}`);
            return Promise.resolve();
          },
          sourceExists: () => Promise.resolve(true),
        }),
    });

    expect(operationLog).toEqual([
      "lock:user-1",
      "delete:",
      "insert:dest-2",
      "status:dest-1,dest-2",
      "request:user-1",
    ]);
  });

  it("throws when projected mappings exceed entitlement limit", () => {
    let replaceCalled = false;
    expect(
      runSetDestinationsForSource("user-1", "source-1", ["dest-1", "dest-2", "dest-3"], {
        resolveMappingLimit: () => Promise.resolve(0),
        withTransaction: (transactionCallback) =>
          transactionCallback({
            acquireUserLock: () => Promise.resolve(),
            countMappingsForSource: () => Promise.resolve(1),
            countUserMappings: () => Promise.resolve(3),
            ensureDestinationSyncStatuses: () => Promise.resolve(),
            deleteSourceMappings: () => {
              replaceCalled = true;
              return Promise.resolve();
            },
            findExistingDestinationIds: () => Promise.resolve([]),
            findOwnedDestinationIds: () => Promise.resolve(["dest-1", "dest-2", "dest-3"]),
            insertSourceMappings: () => {
              replaceCalled = true;
              return Promise.resolve();
            },
            sourceExists: () => Promise.resolve(true),
          }),
      }),
    ).rejects.toThrow("Mapping limit reached");

    expect(replaceCalled).toBe(false);

  });
});

describe("mapping transaction adversarial behavior", () => {
  it("serializes concurrent destination writes for the same source", async () => {
    let mappings = new Set<string>([
      createMappingKey("source-1", "dest-0"),
    ]);
    const lockManager = createUserLockManager();

    const withTransaction = async <TResult>(
      transactionCallback: (transaction: {
        acquireUserLock: (userId: string) => Promise<void>;
        sourceExists: (userId: string, sourceCalendarId: string) => Promise<boolean>;
        findOwnedDestinationIds: (
          userId: string,
          destinationCalendarIds: string[],
        ) => Promise<string[]>;
        findExistingDestinationIds: (sourceCalendarId: string) => Promise<string[]>;
        deleteSourceMappings: (
          sourceCalendarId: string,
          destinationCalendarIds: string[],
        ) => Promise<void>;
        insertSourceMappings: (
          sourceCalendarId: string,
          destinationCalendarIds: string[],
        ) => Promise<void>;
        ensureDestinationSyncStatuses: (destinationCalendarIds: string[]) => Promise<void>;
      }) => Promise<TResult>,
    ): Promise<TResult> => {
      const draftMappings = new Set(mappings);
      let releaseLock: () => void = releaseLockNoop;

      try {
        const result = await transactionCallback({
          acquireUserLock: async (userId) => {
            releaseLock = await lockManager.acquire(userId);
          },
          ensureDestinationSyncStatuses: () => Promise.resolve(),
          findOwnedDestinationIds: (_userId, destinationCalendarIds) =>
            Promise.resolve(destinationCalendarIds),
          deleteSourceMappings: async (sourceCalendarId, destinationCalendarIds) => {
            for (const destinationCalendarId of destinationCalendarIds) {
              draftMappings.delete(createMappingKey(sourceCalendarId, destinationCalendarId));
            }
            await new Promise((resolve) => { setTimeout(resolve, 5); });
          },
          findExistingDestinationIds: (sourceCalendarId) =>
            Promise.resolve(collectDestinationIds(draftMappings, sourceCalendarId)),
          insertSourceMappings: (sourceCalendarId, destinationCalendarIds) => {
            for (const destinationCalendarId of destinationCalendarIds) {
              draftMappings.add(createMappingKey(sourceCalendarId, destinationCalendarId));
            }
            return Promise.resolve();
          },
          sourceExists: () => Promise.resolve(true),
        });

        mappings = draftMappings;
        return result;
      } finally {
        releaseLock();
      }
    };

    const firstWrite = runSetDestinationsForSource("user-1", "source-1", ["dest-1", "dest-2"], {
      withTransaction,
    });
    await new Promise((resolve) => { setTimeout(resolve, 1); });
    const secondWrite = runSetDestinationsForSource("user-1", "source-1", ["dest-3"], {
      withTransaction,
    });

    await Promise.all([firstWrite, secondWrite]);

    expect(collectDestinationIds(mappings, "source-1")).toEqual(["dest-3"]);

  });

  it("rolls back destination mapping writes when transaction fails mid-flight", () => {
    let mappings = new Set<string>([
      createMappingKey("source-1", "dest-0"),
    ]);
    const withTransaction = async <TResult>(
      transactionCallback: (transaction: {
        acquireUserLock: (userId: string) => Promise<void>;
        sourceExists: (userId: string, sourceCalendarId: string) => Promise<boolean>;
        findOwnedDestinationIds: (
          userId: string,
          destinationCalendarIds: string[],
        ) => Promise<string[]>;
        findExistingDestinationIds: (sourceCalendarId: string) => Promise<string[]>;
        deleteSourceMappings: (
          sourceCalendarId: string,
          destinationCalendarIds: string[],
        ) => Promise<void>;
        insertSourceMappings: (
          sourceCalendarId: string,
          destinationCalendarIds: string[],
        ) => Promise<void>;
        ensureDestinationSyncStatuses: (destinationCalendarIds: string[]) => Promise<void>;
      }) => Promise<TResult>,
    ): Promise<TResult> => {
      const draftMappings = new Set(mappings);
      const result = await transactionCallback({
        acquireUserLock: () => Promise.resolve(),
        ensureDestinationSyncStatuses: () =>
          Promise.reject(new Error("status upsert failed")),
        findOwnedDestinationIds: (_userId, destinationCalendarIds) =>
          Promise.resolve(destinationCalendarIds),
        deleteSourceMappings: (sourceCalendarId, destinationCalendarIds) => {
          for (const destinationCalendarId of destinationCalendarIds) {
            draftMappings.delete(createMappingKey(sourceCalendarId, destinationCalendarId));
          }
          return Promise.resolve();
        },
        findExistingDestinationIds: (sourceCalendarId) =>
          Promise.resolve(collectDestinationIds(draftMappings, sourceCalendarId)),
        insertSourceMappings: (sourceCalendarId, destinationCalendarIds) => {
          for (const destinationCalendarId of destinationCalendarIds) {
            draftMappings.add(createMappingKey(sourceCalendarId, destinationCalendarId));
          }
          return Promise.resolve();
        },
        sourceExists: () => Promise.resolve(true),
      });
      mappings = draftMappings;
      return result;
    };

    expect(
      runSetDestinationsForSource("user-1", "source-1", ["dest-1"], {
        withTransaction,
      }),
    ).rejects.toThrow("status upsert failed");

    expect(collectDestinationIds(mappings, "source-1")).toEqual(["dest-0"]);

  });

  it("serializes cross-endpoint writes for the same user", async () => {
    const mappings = new Set<string>([
      createMappingKey("source-a", "dest-legacy"),
      createMappingKey("source-b", "dest-1"),
    ]);
    const lockManager = createUserLockManager();

    const withDestinationTransaction = async <TResult>(
      transactionCallback: (transaction: {
        acquireUserLock: (userId: string) => Promise<void>;
        sourceExists: (userId: string, sourceCalendarId: string) => Promise<boolean>;
        findOwnedDestinationIds: (
          userId: string,
          destinationCalendarIds: string[],
        ) => Promise<string[]>;
        findExistingDestinationIds: (sourceCalendarId: string) => Promise<string[]>;
        deleteSourceMappings: (
          sourceCalendarId: string,
          destinationCalendarIds: string[],
        ) => Promise<void>;
        insertSourceMappings: (
          sourceCalendarId: string,
          destinationCalendarIds: string[],
        ) => Promise<void>;
        ensureDestinationSyncStatuses: (destinationCalendarIds: string[]) => Promise<void>;
      }) => Promise<TResult>,
    ): Promise<TResult> => {
      let releaseLock: () => void = releaseLockNoop;

      try {
        const result = await transactionCallback({
          acquireUserLock: async (userId) => {
            releaseLock = await lockManager.acquire(userId);
          },
          ensureDestinationSyncStatuses: () => Promise.resolve(),
          findOwnedDestinationIds: (_userId, destinationCalendarIds) =>
            Promise.resolve(destinationCalendarIds),
          deleteSourceMappings: async (sourceCalendarId, destinationCalendarIds) => {
            for (const destinationCalendarId of destinationCalendarIds) {
              mappings.delete(createMappingKey(sourceCalendarId, destinationCalendarId));
            }
            await new Promise((resolve) => { setTimeout(resolve, 5); });
          },
          findExistingDestinationIds: (sourceCalendarId) =>
            Promise.resolve(collectDestinationIds(mappings, sourceCalendarId)),
          insertSourceMappings: (sourceCalendarId, destinationCalendarIds) => {
            for (const destinationCalendarId of destinationCalendarIds) {
              mappings.add(createMappingKey(sourceCalendarId, destinationCalendarId));
            }
            return Promise.resolve();
          },
          sourceExists: () => Promise.resolve(true),
        });
        return result;
      } finally {
        releaseLock();
      }
    };

    const withSourceTransaction = async <TResult>(
      transactionCallback: (transaction: {
        acquireUserLock: (userId: string) => Promise<void>;
        destinationExists: (userId: string, destinationCalendarId: string) => Promise<boolean>;
        findOwnedSourceIds: (
          userId: string,
          sourceCalendarIds: string[],
        ) => Promise<string[]>;
        findExistingSourceIds: (destinationCalendarId: string) => Promise<string[]>;
        deleteDestinationMappings: (
          destinationCalendarId: string,
          sourceCalendarIds: string[],
        ) => Promise<void>;
        insertDestinationMappings: (
          destinationCalendarId: string,
          sourceCalendarIds: string[],
        ) => Promise<void>;
        ensureDestinationSyncStatuses: (destinationCalendarIds: string[]) => Promise<void>;
      }) => Promise<TResult>,
    ): Promise<TResult> => {
      let releaseLock: () => void = releaseLockNoop;

      try {
        const result = await transactionCallback({
          acquireUserLock: async (userId) => {
            releaseLock = await lockManager.acquire(userId);
          },
          destinationExists: () => Promise.resolve(true),
          ensureDestinationSyncStatuses: () => Promise.resolve(),
          findOwnedSourceIds: (_userId, sourceCalendarIds) =>
            Promise.resolve(sourceCalendarIds),
          deleteDestinationMappings: async (destinationCalendarId, sourceCalendarIds) => {
            for (const sourceCalendarId of sourceCalendarIds) {
              mappings.delete(createMappingKey(sourceCalendarId, destinationCalendarId));
            }
            await new Promise((resolve) => { setTimeout(resolve, 5); });
          },
          findExistingSourceIds: (destinationCalendarId) =>
            Promise.resolve(collectSourceIds(mappings, destinationCalendarId)),
          insertDestinationMappings: (destinationCalendarId, sourceCalendarIds) => {
            for (const sourceCalendarId of sourceCalendarIds) {
              mappings.add(createMappingKey(sourceCalendarId, destinationCalendarId));
            }
            return Promise.resolve();
          },
        });
        return result;
      } finally {
        releaseLock();
      }
    };

    const destinationWrite = runSetDestinationsForSource(
      "user-1",
      "source-a",
      ["dest-1", "dest-2"],
      {
        withTransaction: withDestinationTransaction,
      },
    );
    await new Promise((resolve) => { setTimeout(resolve, 1); });
    const sourceWrite = runSetSourcesForDestination(
      "user-1",
      "dest-1",
      ["source-b"],
      {
        withTransaction: withSourceTransaction,
      },
    );

    await Promise.all([destinationWrite, sourceWrite]);

    expect(collectDestinationIds(mappings, "source-a")).toEqual(["dest-2"]);
    expect(collectSourceIds(mappings, "dest-1")).toEqual(["source-b"]);
  });
});

describe("runSetSourcesForDestination", () => {
  it("throws when destination calendar is not found", () => {
    expect(
      runSetSourcesForDestination("user-1", "dest-1", ["source-1"], {
        withTransaction: (transactionCallback) =>
          transactionCallback({
            acquireUserLock: () => Promise.resolve(),
            deleteDestinationMappings: () => Promise.resolve(),
            destinationExists: () => Promise.resolve(false),
            ensureDestinationSyncStatuses: () => Promise.resolve(),
            findExistingSourceIds: () => Promise.resolve([]),
            findOwnedSourceIds: () => Promise.resolve(["source-1"]),
            insertDestinationMappings: () => Promise.resolve(),
          }),
      }),
    ).rejects.toThrow("Destination calendar not found");
  });

  it("throws when source calendars include invalid IDs", () => {
    expect(
      runSetSourcesForDestination("user-1", "dest-1", ["source-1", "source-2"], {
        withTransaction: (transactionCallback) =>
          transactionCallback({
            acquireUserLock: () => Promise.resolve(),
            deleteDestinationMappings: () => Promise.resolve(),
            destinationExists: () => Promise.resolve(true),
            ensureDestinationSyncStatuses: () => Promise.resolve(),
            findExistingSourceIds: () => Promise.resolve([]),
            findOwnedSourceIds: () => Promise.resolve(["source-1"]),
            insertDestinationMappings: () => Promise.resolve(),
          }),
      }),
    ).rejects.toThrow("Some source calendars not found");
  });

  it("replaces mappings and triggers sync without status upsert for empty sources", async () => {
    const operationLog: string[] = [];

    await runSetSourcesForDestination("user-1", "dest-1", [], {
      withTransaction: (transactionCallback) =>
        transactionCallback({
          acquireUserLock: (userId) => {
            operationLog.push(`lock:${userId}`);
            return Promise.resolve();
          },
          deleteDestinationMappings: (_destinationCalendarId, sourceCalendarIds) => {
            operationLog.push(`delete:${sourceCalendarIds.length}`);
            return Promise.resolve();
          },
          destinationExists: () => Promise.resolve(true),
          ensureDestinationSyncStatuses: () => {
            operationLog.push("status");
            return Promise.resolve();
          },
          findExistingSourceIds: () => Promise.resolve([]),
          findOwnedSourceIds: () => Promise.resolve([]),
          insertDestinationMappings: (_destinationCalendarId, sourceCalendarIds) => {
            operationLog.push(`insert:${sourceCalendarIds.length}`);
            return Promise.resolve();
          },
          requestUserSync: (userId) => {
            operationLog.push(`request:${userId}`);
            return Promise.resolve();
          },
        }),
    });

    expect(operationLog).toEqual([
      "lock:user-1",
      "delete:0",
      "insert:0",
      "request:user-1",
    ]);
  });

  it("upserts destination sync status when assigning non-empty sources", async () => {
    const operationLog: string[] = [];

    await runSetSourcesForDestination("user-1", "dest-1", ["source-1"], {
      withTransaction: (transactionCallback) =>
        transactionCallback({
          acquireUserLock: () => Promise.resolve(),
          deleteDestinationMappings: (_destinationCalendarId, sourceCalendarIds) => {
            operationLog.push(`delete:${sourceCalendarIds.join(",")}`);
            return Promise.resolve();
          },
          destinationExists: () => Promise.resolve(true),
          ensureDestinationSyncStatuses: (destinationCalendarIds) => {
            operationLog.push(`status:${destinationCalendarIds.join(",")}`);
            return Promise.resolve();
          },
          findExistingSourceIds: () => Promise.resolve([]),
          findOwnedSourceIds: () => Promise.resolve(["source-1"]),
          insertDestinationMappings: (_destinationCalendarId, sourceCalendarIds) => {
            operationLog.push(`insert:${sourceCalendarIds.join(",")}`);
            return Promise.resolve();
          },
        }),
    });

    expect(operationLog).toEqual([
      "delete:",
      "insert:source-1",
      "status:dest-1",
    ]);
  });

  it("throws when projected mappings exceed entitlement limit", () => {
    let replaceCalled = false;
    expect(
      runSetSourcesForDestination("user-1", "dest-1", ["source-1", "source-2"], {
        resolveMappingLimit: () => Promise.resolve(0),
        withTransaction: (transactionCallback) =>
          transactionCallback({
            acquireUserLock: () => Promise.resolve(),
            countMappingsForDestination: () => Promise.resolve(1),
            countUserMappings: () => Promise.resolve(3),
            deleteDestinationMappings: () => {
              replaceCalled = true;
              return Promise.resolve();
            },
            destinationExists: () => Promise.resolve(true),
            ensureDestinationSyncStatuses: () => Promise.resolve(),
            findExistingSourceIds: () => Promise.resolve([]),
            findOwnedSourceIds: () => Promise.resolve(["source-1", "source-2"]),
            insertDestinationMappings: () => {
              replaceCalled = true;
              return Promise.resolve();
            },
          }),
      }),
    ).rejects.toThrow("Mapping limit reached");

    expect(replaceCalled).toBe(false);

  });
});
