import { beforeEach, describe, expect, it, vi } from "vitest";

type Event = Record<string, unknown>;

let current: Event = {};
let flushed: Event[] = [];
let reached = true;
let recordFails = false;

vi.mock("@/utils/logging", () => ({
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

vi.mock("@/utils/error-labelling", () => ({
  labelFailure: () => null,
}));

vi.mock("@/context", () => ({ database: {} }));

vi.mock("@keeper.sh/database", () => ({
  recordUserMilestone: () => {
    if (recordFails) {
      return Promise.reject(new Error("connection closed"));
    }
    return Promise.resolve(reached);
  },
}));

const { noteUserMilestone } = await import("@/utils/user-milestones");

beforeEach(() => {
  current = {};
  flushed = [];
  reached = true;
  recordFails = false;
});

describe("noteUserMilestone", () => {
  it("emits a lifecycle event the first time a user reaches a milestone", async () => {
    await noteUserMilestone("user-1", "first_calendar_connected");

    expect(flushed).toEqual([{
      "operation.name": "user.first_calendar_connected",
      "operation.type": "lifecycle",
      outcome: "success",
      "user.id": "user-1",
    }]);
  });

  it("stays quiet when the user had already reached it", async () => {
    reached = false;

    await noteUserMilestone("user-1", "first_sync_created");

    expect(flushed).toEqual([]);
  });

  it("reports a failure to record without throwing into the request", async () => {
    recordFails = true;

    await expect(noteUserMilestone("user-1", "first_sync_created")).resolves.toBeUndefined();
    expect(flushed.map((event) => event.outcome)).toEqual(["error"]);
  });

  it("leaves the caller's own event untouched", async () => {
    current = { "operation.name": "PUT /api/sources/:id/destinations" };

    await noteUserMilestone("user-1", "first_sync_created");

    expect(current).toEqual({ "operation.name": "PUT /api/sources/:id/destinations" });
  });
});
