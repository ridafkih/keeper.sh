import { describe, expect, it } from "bun:test";
import {
  runSetDestinationsForSource,
  runSetSourcesForDestination,
} from "./source-destination-mappings";

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

describe("runSetDestinationsForSource", () => {
  it("throws when source calendar is not found and does not trigger sync", () => {
    expect(
      runSetDestinationsForSource("user-1", "source-1", ["dest-1"], {
        withTransaction: (transactionCallback) =>
          transactionCallback({
            acquireUserLock: () => Promise.resolve(),
            findOwnedDestinationIds: () => Promise.resolve(["dest-1"]),
            replaceSourceMappings: () => Promise.resolve(),
            ensureDestinationSyncStatuses: () => Promise.resolve(),
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
            findOwnedDestinationIds: () => Promise.resolve(["dest-1"]),
            replaceSourceMappings: () => Promise.resolve(),
            ensureDestinationSyncStatuses: () => Promise.resolve(),
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
          findOwnedDestinationIds: () => Promise.resolve(["dest-1", "dest-2"]),
          replaceSourceMappings: (_sourceCalendarId, destinationIds) => {
            operationLog.push(`replace:${destinationIds.join(",")}`);
            return Promise.resolve();
          },
          sourceExists: () => Promise.resolve(true),
        }),
    });

    expect(operationLog).toEqual([
      "lock:user-1",
      "replace:dest-1,dest-2",
      "status:dest-1,dest-2",
    ]);
  });

  it("throws when projected mappings exceed entitlement limit", () => {
    let replaceCalled = false;
    expect(
      runSetDestinationsForSource("user-1", "source-1", ["dest-1", "dest-2", "dest-3"], {
        isMappingCountAllowed: () => Promise.resolve(false),
        withTransaction: (transactionCallback) =>
          transactionCallback({
            acquireUserLock: () => Promise.resolve(),
            countMappingsForSource: () => Promise.resolve(1),
            countUserMappings: () => Promise.resolve(3),
            ensureDestinationSyncStatuses: () => Promise.resolve(),
            findOwnedDestinationIds: () => Promise.resolve(["dest-1", "dest-2", "dest-3"]),
            replaceSourceMappings: () => {
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
        replaceSourceMappings: (
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
          replaceSourceMappings: async (sourceCalendarId, destinationCalendarIds) => {
            const mappingKeys = [...draftMappings];
            for (const mappingKey of mappingKeys) {
              const mapping = parseMappingKey(mappingKey);
              if (mapping.sourceCalendarId === sourceCalendarId) {
                draftMappings.delete(mappingKey);
              }
            }

            await Bun.sleep(5);

            for (const destinationCalendarId of destinationCalendarIds) {
              draftMappings.add(createMappingKey(sourceCalendarId, destinationCalendarId));
            }
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
    await Bun.sleep(1);
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
    let triggerCount = 0;

    const withTransaction = async <TResult>(
      transactionCallback: (transaction: {
        acquireUserLock: (userId: string) => Promise<void>;
        sourceExists: (userId: string, sourceCalendarId: string) => Promise<boolean>;
        findOwnedDestinationIds: (
          userId: string,
          destinationCalendarIds: string[],
        ) => Promise<string[]>;
        replaceSourceMappings: (
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
        replaceSourceMappings: (sourceCalendarId, destinationCalendarIds) => {
          const mappingKeys = [...draftMappings];
          for (const mappingKey of mappingKeys) {
            const mapping = parseMappingKey(mappingKey);
            if (mapping.sourceCalendarId === sourceCalendarId) {
              draftMappings.delete(mappingKey);
            }
          }
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
        replaceSourceMappings: (
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
          replaceSourceMappings: async (sourceCalendarId, destinationCalendarIds) => {
            const mappingKeys = [...mappings];
            for (const mappingKey of mappingKeys) {
              const mapping = parseMappingKey(mappingKey);
              if (mapping.sourceCalendarId === sourceCalendarId) {
                mappings.delete(mappingKey);
              }
            }

            await Bun.sleep(5);

            for (const destinationCalendarId of destinationCalendarIds) {
              mappings.add(createMappingKey(sourceCalendarId, destinationCalendarId));
            }
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
        replaceDestinationMappings: (
          destinationCalendarId: string,
          sourceCalendarIds: string[],
        ) => Promise<void>;
        ensureDestinationSyncStatus: (destinationCalendarId: string) => Promise<void>;
      }) => Promise<TResult>,
    ): Promise<TResult> => {
      let releaseLock: () => void = releaseLockNoop;

      try {
        const result = await transactionCallback({
          acquireUserLock: async (userId) => {
            releaseLock = await lockManager.acquire(userId);
          },
          destinationExists: () => Promise.resolve(true),
          ensureDestinationSyncStatus: () => Promise.resolve(),
          findOwnedSourceIds: (_userId, sourceCalendarIds) =>
            Promise.resolve(sourceCalendarIds),
          replaceDestinationMappings: async (destinationCalendarId, sourceCalendarIds) => {
            const mappingKeys = [...mappings];
            for (const mappingKey of mappingKeys) {
              const mapping = parseMappingKey(mappingKey);
              if (mapping.destinationCalendarId === destinationCalendarId) {
                mappings.delete(mappingKey);
              }
            }

            await Bun.sleep(5);

            for (const sourceCalendarId of sourceCalendarIds) {
              mappings.add(createMappingKey(sourceCalendarId, destinationCalendarId));
            }
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
    await Bun.sleep(1);
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
            destinationExists: () => Promise.resolve(false),
            ensureDestinationSyncStatus: () => Promise.resolve(),
            findOwnedSourceIds: () => Promise.resolve(["source-1"]),
            replaceDestinationMappings: () => Promise.resolve(),
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
            destinationExists: () => Promise.resolve(true),
            ensureDestinationSyncStatus: () => Promise.resolve(),
            findOwnedSourceIds: () => Promise.resolve(["source-1"]),
            replaceDestinationMappings: () => Promise.resolve(),
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
          destinationExists: () => Promise.resolve(true),
          ensureDestinationSyncStatus: () => {
            operationLog.push("status");
            return Promise.resolve();
          },
          findOwnedSourceIds: () => Promise.resolve([]),
          replaceDestinationMappings: (_destinationCalendarId, sourceCalendarIds) => {
            operationLog.push(`replace:${sourceCalendarIds.length}`);
            return Promise.resolve();
          },
        }),
    });

    expect(operationLog).toEqual([
      "lock:user-1",
      "replace:0",
    ]);
  });

  it("upserts destination sync status when assigning non-empty sources", async () => {
    const operationLog: string[] = [];

    await runSetSourcesForDestination("user-1", "dest-1", ["source-1"], {
      withTransaction: (transactionCallback) =>
        transactionCallback({
          acquireUserLock: () => Promise.resolve(),
          destinationExists: () => Promise.resolve(true),
          ensureDestinationSyncStatus: (destinationCalendarId) => {
            operationLog.push(`status:${destinationCalendarId}`);
            return Promise.resolve();
          },
          findOwnedSourceIds: () => Promise.resolve(["source-1"]),
          replaceDestinationMappings: (_destinationCalendarId, sourceCalendarIds) => {
            operationLog.push(`replace:${sourceCalendarIds.join(",")}`);
            return Promise.resolve();
          },
        }),
    });

    expect(operationLog).toEqual([
      "replace:source-1",
      "status:dest-1",
    ]);
  });

  it("throws when projected mappings exceed entitlement limit", () => {
    let replaceCalled = false;
    expect(
      runSetSourcesForDestination("user-1", "dest-1", ["source-1", "source-2"], {
        isMappingCountAllowed: () => Promise.resolve(false),
        withTransaction: (transactionCallback) =>
          transactionCallback({
            acquireUserLock: () => Promise.resolve(),
            countMappingsForDestination: () => Promise.resolve(1),
            countUserMappings: () => Promise.resolve(3),
            destinationExists: () => Promise.resolve(true),
            ensureDestinationSyncStatus: () => Promise.resolve(),
            findOwnedSourceIds: () => Promise.resolve(["source-1", "source-2"]),
            replaceDestinationMappings: () => {
              replaceCalled = true;
              return Promise.resolve();
            },
          }),
      }),
    ).rejects.toThrow("Mapping limit reached");

    expect(replaceCalled).toBe(false);

  });
});
