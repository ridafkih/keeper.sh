import { calendarsTable } from "@keeper.sh/database/schema";
import { beforeEach, describe, expect, it, vi } from "vitest";

const USER_ID = "6c1f9a52-3d7e-4f31-9a10-8b2c4d5e6f70";

const state: {
  clearedRows: { id: string }[];
  enqueued: string[];
  updates: { table: unknown; values: Record<string, unknown> }[];
} = {
  clearedRows: [],
  enqueued: [],
  updates: [],
};

const databaseStub = {
  update: (table: unknown) => ({
    set: (values: Record<string, unknown>) => {
      state.updates.push({ table, values });
      return {
        where: () => ({
          returning: () => Promise.resolve(state.clearedRows),
        }),
      };
    },
  }),
};

vi.mock("@/context", () => ({ database: databaseStub }));
vi.mock("@/utils/enqueue-push-sync", () => ({
  enqueuePushSync: (userId: string) => {
    state.enqueued.push(userId);
    return Promise.resolve();
  },
}));

const { triggerSync } = await import("@/utils/trigger-sync");

describe("the columns a manual sync clears", () => {
  beforeEach(() => {
    state.clearedRows = [{ id: "calendar-1" }, { id: "calendar-2" }];
    state.enqueued = [];
    state.updates = [];
  });

  it("clears the attempt clocks for the user's active calendars", async () => {
    const result = await triggerSync(USER_ID, "pro");

    expect(result).toEqual({ sourcesRefreshed: 2, triggered: true });
    expect(state.enqueued).toEqual([USER_ID]);
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0]?.table).toBe(calendarsTable);
  });

  it("resets the failure ladder so a later failure does not resume at the cap", async () => {
    await triggerSync(USER_ID, "pro");

    expect(state.updates[0]?.values).toEqual({
      failureCount: 0,
      lastFailureAt: null,
      nextAttemptAt: null,
      ingestFailureCount: 0,
      ingestLastFailureAt: null,
      ingestNextAttemptAt: null,
    });
  });

  it("stays idempotent when the user triggers a sync twice", async () => {
    await triggerSync(USER_ID, "pro");
    const first = state.updates.map(({ values }) => values);
    state.updates = [];

    await triggerSync(USER_ID, "pro");

    expect(state.updates.map(({ values }) => values)).toEqual(first);
  });

  it("reports nothing refreshed when no calendar was backed off", async () => {
    state.clearedRows = [];

    expect(await triggerSync(USER_ID, "free")).toEqual({
      sourcesRefreshed: 0,
      triggered: true,
    });
    expect(state.enqueued).toEqual([USER_ID]);
  });
});
