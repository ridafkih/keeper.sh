import { describe, expect, it } from "bun:test";
import { syncDestinationsForUser } from "./destinations";
import type { DestinationProvider } from "./destinations";
import type { SyncResult } from "../types";
import type { SyncContext, SyncCoordinator } from "./coordinator";

const createMockCoordinator = (): SyncCoordinator => {
  let generation = 0;

  return {
    startSync: (userId: string): Promise<SyncContext> => {
      generation++;
      return Promise.resolve({
        generation,
        isCurrent: () => Promise.resolve(true),
        userId,
      });
    },
    isSyncCurrent: (context: SyncContext) => context.isCurrent(),
  };
};

const createSuccessProvider = (result: SyncResult): DestinationProvider => ({
  syncForUser: () => Promise.resolve(result),
});

const createNullProvider = (): DestinationProvider => ({
  syncForUser: () => Promise.resolve(null),
});

const createFailingProvider = (error: Error): DestinationProvider => ({
  syncForUser: () => { throw error; },
});

describe("syncDestinationsForUser", () => {
  it("aggregates results from multiple successful providers", async () => {
    const providers = [
      createSuccessProvider({ added: 3, addFailed: 1, removed: 2, removeFailed: 0 }),
      createSuccessProvider({ added: 5, addFailed: 0, removed: 1, removeFailed: 1 }),
    ];

    const result = await syncDestinationsForUser("user-1", providers, createMockCoordinator());

    expect(result).toEqual({
      addFailed: 1,
      added: 8,
      removeFailed: 1,
      removed: 3,
    });
  });

  it("returns zeros when no providers are given", async () => {
    const result = await syncDestinationsForUser("user-1", [], createMockCoordinator());

    expect(result).toEqual({
      addFailed: 0,
      added: 0,
      removeFailed: 0,
      removed: 0,
    });
  });

  it("skips null results from providers", async () => {
    const providers = [
      createNullProvider(),
      createSuccessProvider({ added: 2, addFailed: 0, removed: 1, removeFailed: 0 }),
    ];

    const result = await syncDestinationsForUser("user-1", providers, createMockCoordinator());

    expect(result).toEqual({
      addFailed: 0,
      added: 2,
      removeFailed: 0,
      removed: 1,
    });
  });

  it("continues processing when one provider fails", async () => {
    const providers = [
      createFailingProvider(new Error("provider down")),
      createSuccessProvider({ added: 4, addFailed: 0, removed: 0, removeFailed: 0 }),
    ];

    const result = await syncDestinationsForUser("user-1", providers, createMockCoordinator());

    expect(result.added).toBe(4);
  });

  it("returns zeros when all providers fail", async () => {
    const providers = [
      createFailingProvider(new Error("fail 1")),
      createFailingProvider(new Error("fail 2")),
    ];

    const result = await syncDestinationsForUser("user-1", providers, createMockCoordinator());

    expect(result).toEqual({
      addFailed: 0,
      added: 0,
      removeFailed: 0,
      removed: 0,
    });
  });

  it("starts sync via coordinator before syncing providers", async () => {
    const syncedContexts: number[] = [];
    const coordinator: SyncCoordinator = {
      startSync: (userId: string): Promise<SyncContext> => {
        const generation = 1;
        return Promise.resolve({
          generation,
          isCurrent: () => Promise.resolve(true),
          userId,
        });
      },
      isSyncCurrent: (context: SyncContext) => {
        syncedContexts.push(context.generation);
        return context.isCurrent();
      },
    };

    const provider: DestinationProvider = {
      syncForUser: (_userId, context) => {
        expect(context.generation).toBe(1);
        return Promise.resolve({ added: 0, addFailed: 0, removed: 0, removeFailed: 0 });
      },
    };

    await syncDestinationsForUser("user-1", [provider], coordinator);

    expect(syncedContexts).toEqual([1]);
  });
});
