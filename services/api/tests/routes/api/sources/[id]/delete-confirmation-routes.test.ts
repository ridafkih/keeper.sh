import { describe, expect, it } from "vitest";
import { handlePatchDeleteConfirmationRoute } from "../../../../../src/routes/api/sources/[id]/mapping-routes";

interface RecordedCall {
  decision: string;
  destinationCalendarId: string;
  sourceCalendarId: string;
  userId: string;
}

const createDependencies = (overrides: {
  canUseTwoWaySync?: boolean;
  recorded?: RecordedCall[];
  resolveDeleteConfirmation?: () => Promise<void>;
} = {}) => {
  const recorded = overrides.recorded ?? [];
  return {
    canUseTwoWaySync: () => Promise.resolve(overrides.canUseTwoWaySync ?? true),
    resolveDeleteConfirmation: overrides.resolveDeleteConfirmation ?? ((
      userId: string,
      sourceCalendarId: string,
      destinationCalendarId: string,
      decision: string,
    ) => {
      recorded.push({ decision, destinationCalendarId, sourceCalendarId, userId });
      return Promise.resolve();
    }),
  };
};

const params = { destinationId: "destination-1", id: "source-1" };

describe("handlePatchDeleteConfirmationRoute", () => {
  it("records the answer that lets the held deletions through", async () => {
    const recorded: RecordedCall[] = [];
    const response = await handlePatchDeleteConfirmationRoute(
      { body: { decision: "apply" }, params, userId: "user-1" },
      createDependencies({ recorded }),
    );

    expect(response.status).toBe(200);
    expect(recorded).toEqual([{
      decision: "apply",
      destinationCalendarId: "destination-1",
      sourceCalendarId: "source-1",
      userId: "user-1",
    }]);
  });

  it("records the answer that puts the copies back", async () => {
    const recorded: RecordedCall[] = [];
    const response = await handlePatchDeleteConfirmationRoute(
      { body: { decision: "decline" }, params, userId: "user-1" },
      createDependencies({ recorded }),
    );

    expect(response.status).toBe(200);
    expect(recorded).toMatchObject([{ decision: "decline" }]);
  });

  it("refuses to approve deletions for a free user", async () => {
    const recorded: RecordedCall[] = [];
    const response = await handlePatchDeleteConfirmationRoute(
      { body: { decision: "apply" }, params, userId: "user-1" },
      createDependencies({ canUseTwoWaySync: false, recorded }),
    );

    expect(response.status).toBe(403);
    expect(recorded).toEqual([]);
  });

  it("rejects an unknown decision", async () => {
    const response = await handlePatchDeleteConfirmationRoute(
      { body: { decision: "maybe" }, params, userId: "user-1" },
      createDependencies(),
    );

    expect(response.status).toBe(400);
  });

  it("says so when the copies the approval was about are still there", async () => {
    const response = await handlePatchDeleteConfirmationRoute(
      { body: { decision: "apply" }, params, userId: "user-1" },
      createDependencies({
        resolveDeleteConfirmation: () => Promise.reject(new Error(
          "The copies are still on the destination calendar,"
          + " so the originals cannot be deleted",
        )),
      }),
    );

    expect(response.status).toBe(409);
  });

  it("returns 404 when the mapping does not exist", async () => {
    const response = await handlePatchDeleteConfirmationRoute(
      { body: { decision: "apply" }, params, userId: "user-1" },
      createDependencies({
        resolveDeleteConfirmation: () => Promise.reject(new Error("Mapping not found")),
      }),
    );

    expect(response.status).toBe(404);
  });
});
