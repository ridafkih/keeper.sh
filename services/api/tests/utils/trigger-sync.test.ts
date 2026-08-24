import { describe, expect, it } from "vitest";
import { runTriggerSync } from "../../src/utils/trigger-sync";
import type { TriggerSyncDependencies } from "../../src/utils/trigger-sync";
import type { Plan } from "@keeper.sh/data-schemas";

interface EnqueueCall {
  userId: string;
  plan: Plan;
}

const createDependencies = (sourcesRefreshed = 2) => {
  const state = {
    backoffClearedFor: [] as string[],
    enqueued: [] as EnqueueCall[],
  };

  const dependencies: TriggerSyncDependencies = {
    clearIngestBackoff: (userId) => {
      state.backoffClearedFor.push(userId);
      return Promise.resolve(sourcesRefreshed);
    },
    enqueuePushSync: (userId, plan) => {
      state.enqueued.push({ plan, userId });
      return Promise.resolve();
    },
  };

  return { dependencies, state };
};

describe("runTriggerSync", () => {
  it("clears the ingest backoff and enqueues a push for the user", async () => {
    const { dependencies, state } = createDependencies();

    const result = await runTriggerSync("user-1", "pro", dependencies);

    expect(state.backoffClearedFor).toEqual(["user-1"]);
    expect(state.enqueued).toEqual([{ plan: "pro", userId: "user-1" }]);
    expect(result).toEqual({ sourcesRefreshed: 2, triggered: true });
  });

  it("reports how many sources had their backoff cleared", async () => {
    const { dependencies } = createDependencies(0);

    const result = await runTriggerSync("user-1", "free", dependencies);

    expect(result.sourcesRefreshed).toBe(0);
    expect(result.triggered).toBe(true);
  });

  it("passes the caller's plan through to the push enqueue", async () => {
    const { dependencies, state } = createDependencies();

    await runTriggerSync("user-2", "free", dependencies);

    expect(state.enqueued[0]?.plan).toBe("free");
  });

  it("propagates a failure to clear the ingest backoff without enqueuing", async () => {
    const { state } = createDependencies();
    const dependencies: TriggerSyncDependencies = {
      clearIngestBackoff: () => Promise.reject(new Error("database unavailable")),
      enqueuePushSync: (userId, plan) => {
        state.enqueued.push({ plan, userId });
        return Promise.resolve();
      },
    };

    await expect(runTriggerSync("user-1", "pro", dependencies)).rejects.toThrow(
      "database unavailable",
    );
    expect(state.enqueued).toEqual([]);
  });

  it("propagates a failure to enqueue the push", async () => {
    const dependencies: TriggerSyncDependencies = {
      clearIngestBackoff: () => Promise.resolve(1),
      enqueuePushSync: () => Promise.reject(new Error("queue unavailable")),
    };

    await expect(runTriggerSync("user-1", "pro", dependencies)).rejects.toThrow(
      "queue unavailable",
    );
  });
});
