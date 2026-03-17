import { describe, expect, it } from "bun:test";
import { handlePatchSourceRoute } from "./source-item-routes";

const readJson = (response: Response): Promise<unknown> => response.json();

describe("handlePatchSourceRoute", () => {
  it("returns 400 when id param is missing", async () => {
    const response = await handlePatchSourceRoute(
      { body: {}, params: {}, userId: "user-1" },
      {
        canUseEventFilters: () => Promise.resolve(true),
        triggerDestinationSync: Boolean,
        updateSource: () => Promise.resolve(null),
      },
    );

    expect(response.status).toBe(400);
  });

  it("returns 400 when no valid fields are provided", async () => {
    const response = await handlePatchSourceRoute(
      { body: { unknown: true }, params: { id: "source-1" }, userId: "user-1" },
      {
        canUseEventFilters: () => Promise.resolve(true),
        triggerDestinationSync: Boolean,
        updateSource: () => Promise.resolve(null),
      },
    );

    expect(response.status).toBe(400);
  });

  it("returns 404 when source update target is missing", async () => {
    const response = await handlePatchSourceRoute(
      {
        body: { name: "Updated Name" },
        params: { id: "source-1" },
        userId: "user-1",
      },
      {
        canUseEventFilters: () => Promise.resolve(true),
        triggerDestinationSync: Boolean,
        updateSource: () => Promise.resolve(null),
      },
    );

    expect(response.status).toBe(404);
  });

  it("returns 403 when free users update the event name template", async () => {
    const response = await handlePatchSourceRoute(
      {
        body: { customEventName: "{{calendar_name}}" },
        params: { id: "source-1" },
        userId: "user-1",
      },
      {
        canUseEventFilters: () => Promise.resolve(false),
        triggerDestinationSync: Boolean,
        updateSource: () => Promise.resolve(null),
      },
    );

    expect(response.status).toBe(403);
    expect(await readJson(response)).toEqual({
      error: "Event filters require a Pro plan.",
    });
  });

  it("triggers destination sync for non-filter updates", async () => {
    const destinationSyncCalls: string[] = [];

    const response = await handlePatchSourceRoute(
      {
        body: { name: "Updated Name" },
        params: { id: "source-1" },
        userId: "user-1",
      },
      {
        canUseEventFilters: () => Promise.resolve(true),
        triggerDestinationSync: (userId) => {
          destinationSyncCalls.push(userId);
        },
        updateSource: (_userId, _sourceId, updates) => Promise.resolve({
          id: "source-1",
          ...updates,
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(destinationSyncCalls).toEqual(["user-1"]);
  });

  it("keeps destination-only exclusion updates on destination sync", async () => {
    const destinationSyncCalls: string[] = [];

    const response = await handlePatchSourceRoute(
      {
        body: { excludeEventDescription: true },
        params: { id: "source-1" },
        userId: "user-1",
      },
      {
        canUseEventFilters: () => Promise.resolve(true),
        triggerDestinationSync: (userId) => {
          destinationSyncCalls.push(userId);
        },
        updateSource: (_userId, _sourceId, updates) => Promise.resolve({
          id: "source-1",
          ...updates,
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(destinationSyncCalls).toEqual(["user-1"]);
  });
});
