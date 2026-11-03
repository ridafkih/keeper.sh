import { describe, expect, it } from "vitest";
import {
  type MappingMutationSyncLock,
  runChangeDestinationsForSource,
  runSetDestinationsForSource,
  runSetSourcesForDestination,
  runWithMappingMutationLocks,
} from "../../src/utils/source-destination-mappings";
import {
  describeMappingChange,
  listNewlyMappedIds,
  listNewlyMappedSourcesOfSource,
} from "../../src/utils/mapping-change";

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
            findOwnedDestinationIds: () => Promise.resolve(["dest-1"]),
            listSourceDestinationIds: () => Promise.resolve([]),
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
            listSourceDestinationIds: () => Promise.resolve([]),
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
          listSourceDestinationIds: () => Promise.resolve([]),
          replaceSourceMappings: (_sourceCalendarId, destinationIds) => {
            operationLog.push(`replace:${destinationIds.join(",")}`);
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
      "replace:dest-1,dest-2",
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
            listSourceDestinationIds: () => Promise.resolve(["dest-0"]),
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
        listSourceDestinationIds: (sourceCalendarId: string) => Promise<string[]>;
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
          listSourceDestinationIds: () => Promise.resolve([]),
          replaceSourceMappings: async (sourceCalendarId, destinationCalendarIds) => {
            const mappingKeys = [...draftMappings];
            for (const mappingKey of mappingKeys) {
              const mapping = parseMappingKey(mappingKey);
              if (mapping.sourceCalendarId === sourceCalendarId) {
                draftMappings.delete(mappingKey);
              }
            }

            await new Promise((resolve) => { setTimeout(resolve, 5); });

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
        listSourceDestinationIds: (sourceCalendarId: string) => Promise<string[]>;
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
        listSourceDestinationIds: () => Promise.resolve([]),
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
        listSourceDestinationIds: (sourceCalendarId: string) => Promise<string[]>;
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
          listSourceDestinationIds: () => Promise.resolve([]),
          replaceSourceMappings: async (sourceCalendarId, destinationCalendarIds) => {
            const mappingKeys = [...mappings];
            for (const mappingKey of mappingKeys) {
              const mapping = parseMappingKey(mappingKey);
              if (mapping.sourceCalendarId === sourceCalendarId) {
                mappings.delete(mappingKey);
              }
            }

            await new Promise((resolve) => { setTimeout(resolve, 5); });

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
        listDestinationSourceIds: (destinationCalendarId: string) => Promise<string[]>;
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
          listDestinationSourceIds: () => Promise.resolve([]),
          replaceDestinationMappings: async (destinationCalendarId, sourceCalendarIds) => {
            const mappingKeys = [...mappings];
            for (const mappingKey of mappingKeys) {
              const mapping = parseMappingKey(mappingKey);
              if (mapping.destinationCalendarId === destinationCalendarId) {
                mappings.delete(mappingKey);
              }
            }

            await new Promise((resolve) => { setTimeout(resolve, 5); });

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
            destinationExists: () => Promise.resolve(false),
            ensureDestinationSyncStatus: () => Promise.resolve(),
            findOwnedSourceIds: () => Promise.resolve(["source-1"]),
            listDestinationSourceIds: () => Promise.resolve([]),
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
            listDestinationSourceIds: () => Promise.resolve([]),
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
          listDestinationSourceIds: () => Promise.resolve([]),
          replaceDestinationMappings: (_destinationCalendarId, sourceCalendarIds) => {
            operationLog.push(`replace:${sourceCalendarIds.length}`);
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
      "replace:0",
      "request:user-1",
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
          listDestinationSourceIds: () => Promise.resolve([]),
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
        resolveMappingLimit: () => Promise.resolve(0),
        withTransaction: (transactionCallback) =>
          transactionCallback({
            acquireUserLock: () => Promise.resolve(),
            listDestinationSourceIds: () => Promise.resolve(["source-0"]),
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

describe("toggling one mapping at a time", () => {
  const createSourceStore = (initial: string[]) => {
    let mappings = new Set(initial.map((destinationId) => createMappingKey("source-1", destinationId)));
    const lockManager = createUserLockManager();

    const withTransaction = async <TResult>(
      transactionCallback: Parameters<Parameters<typeof runChangeDestinationsForSource>[3]["withTransaction"]>[0],
    ): Promise<TResult> => {
      let draftMappings = new Set(mappings);
      let releaseLock: () => void = releaseLockNoop;
      try {
        const result = await transactionCallback({
          acquireUserLock: async (userId) => {
            releaseLock = await lockManager.acquire(userId);
            draftMappings = new Set(mappings);
          },
          ensureDestinationSyncStatuses: () => Promise.resolve(),
          findOwnedDestinationIds: (_userId, destinationCalendarIds) =>
            Promise.resolve(destinationCalendarIds),
          listSourceDestinationIds: (sourceCalendarId) =>
            Promise.resolve(collectDestinationIds(draftMappings, sourceCalendarId)),
          replaceSourceMappings: async (sourceCalendarId, destinationCalendarIds) => {
            for (const mappingKey of [...draftMappings]) {
              if (parseMappingKey(mappingKey).sourceCalendarId === sourceCalendarId) {
                draftMappings.delete(mappingKey);
              }
            }
            await new Promise((resolve) => { setTimeout(resolve, 5); });
            for (const destinationCalendarId of destinationCalendarIds) {
              draftMappings.add(createMappingKey(sourceCalendarId, destinationCalendarId));
            }
          },
          sourceExists: () => Promise.resolve(true),
        });
        mappings = draftMappings;
        return result as TResult;
      } finally {
        releaseLock();
      }
    };

    return { read: () => collectDestinationIds(mappings, "source-1"), withTransaction };
  };

  it("keeps every destination toggled on in the same tick", async () => {
    const store = createSourceStore([]);

    await Promise.all([
      runChangeDestinationsForSource("user-1", "source-1", { calendarId: "dest-a", enabled: true, kind: "toggle" }, store),
      runChangeDestinationsForSource("user-1", "source-1", { calendarId: "dest-b", enabled: true, kind: "toggle" }, store),
    ]);

    expect(store.read()).toEqual(["dest-a", "dest-b"]);
  });

  it("removes only the toggled destination and reports the mapping before and after", async () => {
    const store = createSourceStore(["dest-a", "dest-b"]);

    const result = await runChangeDestinationsForSource(
      "user-1",
      "source-1",
      { calendarId: "dest-a", enabled: false, kind: "toggle" },
      store,
    );

    expect(store.read()).toEqual(["dest-b"]);
    expect(result).toEqual({ nextIds: ["dest-b"], previousIds: ["dest-a", "dest-b"] });
  });

  it("lets a user over the mapping limit remove a mapping", async () => {
    const result = await runChangeDestinationsForSource(
      "user-1",
      "source-1",
      { calendarId: "dest-a", enabled: false, kind: "toggle" },
      {
        resolveMappingLimit: () => Promise.resolve(0),
        withTransaction: (transactionCallback) =>
          transactionCallback({
            acquireUserLock: () => Promise.resolve(),
            countUserMappings: () => Promise.resolve(5),
            ensureDestinationSyncStatuses: () => Promise.resolve(),
            findOwnedDestinationIds: () => Promise.resolve([]),
            listSourceDestinationIds: () => Promise.resolve(["dest-a", "dest-b"]),
            replaceSourceMappings: () => Promise.resolve(),
            sourceExists: () => Promise.resolve(true),
          }),
      },
    );

    expect(result.nextIds).toEqual(["dest-b"]);
  });
});

describe("sources a mapping change asks to read now", () => {
  it("reads the source when it gains a destination", () => {
    expect(listNewlyMappedSourcesOfSource("source-1", { nextIds: ["dest-1", "dest-2"], previousIds: ["dest-1"] }))
      .toEqual(["source-1"]);
  });

  it("reads nothing when the source only loses destinations", () => {
    expect(listNewlyMappedSourcesOfSource("source-1", { nextIds: [], previousIds: ["dest-1"] })).toEqual([]);
  });

  it("reads each source a destination gains", () => {
    expect(listNewlyMappedIds({ nextIds: ["source-1", "source-2"], previousIds: ["source-1"] }))
      .toEqual(["source-2"]);
  });
});

describe("describeMappingChange", () => {
  it("records how many mappings a save added and removed", () => {
    expect(describeMappingChange(
      { calendarIds: ["dest-2", "dest-3"], kind: "replace" },
      { nextIds: ["dest-2", "dest-3"], previousIds: ["dest-1", "dest-2"] },
    )).toEqual({
      "mappings.added_count": 1,
      "mappings.after_count": 2,
      "mappings.before_count": 2,
      "mappings.change": "replace",
      "mappings.removed_count": 1,
    });
  });

  it("records a toggle that changed nothing", () => {
    expect(describeMappingChange(
      { calendarId: "dest-1", enabled: true, kind: "toggle" },
      { nextIds: ["dest-1"], previousIds: ["dest-1"] },
    )).toMatchObject({ "mappings.added_count": 0, "mappings.change": "toggle", "mappings.removed_count": 0 });
  });
});
