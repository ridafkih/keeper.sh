import { describe, expect, it } from "vitest";
import { handlePatchMappingWriteBackModeRoute } from "../../../../../src/routes/api/sources/[id]/mapping-routes";

const readJson = (response: Response): Promise<unknown> => response.json();

interface RecordedCall {
  destinationCalendarId: string;
  sourceCalendarId: string;
  userId: string;
  writeBackMode: string;
}

const createDependencies = (overrides: {
  canUseTwoWaySync?: boolean;
  recorded?: RecordedCall[];
  setWriteBackMode?: () => Promise<void>;
  sourceSupportsWriteBack?: boolean;
} = {}) => {
  const recorded = overrides.recorded ?? [];
  return {
    canUseTwoWaySync: () => Promise.resolve(overrides.canUseTwoWaySync ?? true),
    setWriteBackMode: overrides.setWriteBackMode ?? ((
      userId: string,
      sourceCalendarId: string,
      destinationCalendarId: string,
      writeBackMode: string,
    ) => {
      recorded.push({ destinationCalendarId, sourceCalendarId, userId, writeBackMode });
      return Promise.resolve();
    }),
    sourceSupportsWriteBack: () =>
      Promise.resolve(overrides.sourceSupportsWriteBack ?? true),
  };
};

const params = { destinationId: "destination-1", id: "source-1" };

describe("handlePatchMappingWriteBackModeRoute", () => {
  it("refuses to enable two-way sync for a free user", async () => {
    const recorded: RecordedCall[] = [];
    const response = await handlePatchMappingWriteBackModeRoute(
      { body: { writeBackMode: "edits" }, params, userId: "user-1" },
      createDependencies({ canUseTwoWaySync: false, recorded }),
    );

    expect(response.status).toBe(403);
    expect(await readJson(response)).toMatchObject({
      error: "Two-way sync requires a Pro plan.",
    });
    expect(recorded).toEqual([]);
  });

  it("refuses to enable deletion propagation for a free user", async () => {
    const response = await handlePatchMappingWriteBackModeRoute(
      { body: { writeBackMode: "edits_and_deletes" }, params, userId: "user-1" },
      createDependencies({ canUseTwoWaySync: false }),
    );

    expect(response.status).toBe(403);
  });

  it("lets a free user turn two-way sync back off", async () => {
    const recorded: RecordedCall[] = [];
    const response = await handlePatchMappingWriteBackModeRoute(
      { body: { writeBackMode: "off" }, params, userId: "user-1" },
      createDependencies({ canUseTwoWaySync: false, recorded }),
    );

    expect(response.status).toBe(200);
    expect(recorded).toMatchObject([{ writeBackMode: "off" }]);
  });

  it("persists the mode for a Pro user", async () => {
    const recorded: RecordedCall[] = [];
    const response = await handlePatchMappingWriteBackModeRoute(
      { body: { writeBackMode: "edits_and_deletes" }, params, userId: "user-1" },
      createDependencies({ recorded }),
    );

    expect(response.status).toBe(200);
    expect(recorded).toEqual([{
      destinationCalendarId: "destination-1",
      sourceCalendarId: "source-1",
      userId: "user-1",
      writeBackMode: "edits_and_deletes",
    }]);
  });

  it("rejects a source that cannot be written to", async () => {
    const recorded: RecordedCall[] = [];
    const response = await handlePatchMappingWriteBackModeRoute(
      { body: { writeBackMode: "edits" }, params, userId: "user-1" },
      createDependencies({ recorded, sourceSupportsWriteBack: false }),
    );

    expect(response.status).toBe(400);
    expect(recorded).toEqual([]);
  });

  it("rejects an unknown mode", async () => {
    const response = await handlePatchMappingWriteBackModeRoute(
      { body: { writeBackMode: "two-way-please" }, params, userId: "user-1" },
      createDependencies(),
    );

    expect(response.status).toBe(400);
  });

  it("returns 404 when the mapping does not exist", async () => {
    const response = await handlePatchMappingWriteBackModeRoute(
      { body: { writeBackMode: "edits" }, params, userId: "user-1" },
      createDependencies({
        setWriteBackMode: () => Promise.reject(new Error("Mapping not found")),
      }),
    );

    expect(response.status).toBe(404);
  });

  it("returns 400 when either calendar id is missing", async () => {
    const response = await handlePatchMappingWriteBackModeRoute(
      { body: { writeBackMode: "edits" }, params: { id: "source-1" }, userId: "user-1" },
      createDependencies(),
    );

    expect(response.status).toBe(400);
  });
});
