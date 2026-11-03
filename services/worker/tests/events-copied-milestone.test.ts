import { beforeEach, describe, expect, it, vi } from "vitest";

type Event = Record<string, unknown>;

let current: Event = {};
let flushed: Event[] = [];
let recordCalls: string[] = [];
let reached = true;

vi.mock("../src/utils/logging", () => ({
  context: async (run: () => Promise<unknown>) => {
    const outer = current;
    current = {};
    try {
      return await run();
    } finally {
      current = outer;
    }
  },
  widelog: {
    errorFields: () => null,
    flush: () => {
      flushed.push(current);
    },
    set: (key: string, value: unknown) => {
      current = { ...current, [key]: value };
    },
  },
}));

vi.mock("@keeper.sh/database", () => ({
  recordUserMilestone: (_database: unknown, userId: string) => {
    recordCalls.push(userId);
    return Promise.resolve(reached);
  },
}));

const { createEventsCopiedMilestone } = await import("../src/utils/user-milestones");

beforeEach(() => {
  current = {};
  flushed = [];
  recordCalls = [];
  reached = true;
});

describe("createEventsCopiedMilestone", () => {
  it("emits user.first_events_copied the first time a user's events are copied", async () => {
    const noteEventsCopied = createEventsCopiedMilestone({} as never);

    await noteEventsCopied("user-1");

    expect(flushed).toEqual([{
      "operation.name": "user.first_events_copied",
      "operation.type": "lifecycle",
      outcome: "success",
      "user.id": "user-1",
    }]);
  });

  it("stays quiet for a user who reached it before", async () => {
    reached = false;
    const noteEventsCopied = createEventsCopiedMilestone({} as never);

    await noteEventsCopied("user-1");

    expect(flushed).toEqual([]);
  });

  it("does not ask the database again for a user it already knows reached it", async () => {
    const noteEventsCopied = createEventsCopiedMilestone({} as never);

    await noteEventsCopied("user-1");
    await noteEventsCopied("user-1");

    expect(recordCalls).toEqual(["user-1"]);
  });
});
