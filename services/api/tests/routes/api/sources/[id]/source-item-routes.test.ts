import { describe, expect, it } from "vitest";
import { handlePatchSourceRoute } from "../../../../../src/routes/api/sources/[id]/source-item-routes";

const readJson = (response: Response): Promise<unknown> => response.json();

describe("handlePatchSourceRoute", () => {
  it("returns 400 when id param is missing", async () => {
    const response = await handlePatchSourceRoute(
      { body: {}, params: {}, userId: "user-1" },
      {
        canUseEventFilters: () => Promise.resolve(true),
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
        updateSource: () => Promise.resolve(null),
      },
    );

    expect(response.status).toBe(403);
    expect(await readJson(response)).toEqual({
      error: "This setting requires a Pro plan.",
    });
  });

  it("returns updated source for valid name update", async () => {
    const response = await handlePatchSourceRoute(
      {
        body: { name: "Updated Name" },
        params: { id: "source-1" },
        userId: "user-1",
      },
      {
        canUseEventFilters: () => Promise.resolve(true),
        updateSource: (_userId, _sourceId, updates) => Promise.resolve({
          id: "source-1",
          ...updates,
        }),
      },
    );

    expect(response.status).toBe(200);
  });

  it("returns updated source for exclusion filter update", async () => {
    const response = await handlePatchSourceRoute(
      {
        body: { excludeEventDescription: true },
        params: { id: "source-1" },
        userId: "user-1",
      },
      {
        canUseEventFilters: () => Promise.resolve(true),
        updateSource: (_userId, _sourceId, updates) => Promise.resolve({
          id: "source-1",
          ...updates,
        }),
      },
    );

    expect(response.status).toBe(200);
  });

  it("returns 403 when free users update full-day timed event interpretation", async () => {
    const response = await handlePatchSourceRoute(
      {
        body: { treatFullDayTimedEventsAsAllDay: true },
        params: { id: "source-1" },
        userId: "user-1",
      },
      {
        canUseEventFilters: () => Promise.resolve(false),
        updateSource: (_userId, _sourceId, updates) => Promise.resolve({
          id: "source-1",
          ...updates,
        }),
      },
    );

    expect(response.status).toBe(403);
    expect(await readJson(response)).toEqual({
      error: "This setting requires a Pro plan.",
    });
  });

  it("returns 403 when free users try to set markEventsAsPrivate", async () => {
    const response = await handlePatchSourceRoute(
      {
        body: { markEventsAsPrivate: true },
        params: { id: "source-1" },
        userId: "user-1",
      },
      {
        canUseEventFilters: () => Promise.resolve(false),
        updateSource: () => Promise.resolve(null),
      },
    );

    expect(response.status).toBe(403);
  });

  it("returns updated source when pro user sets markEventsAsPrivate", async () => {
    const response = await handlePatchSourceRoute(
      {
        body: { markEventsAsPrivate: true },
        params: { id: "source-1" },
        userId: "user-1",
      },
      {
        canUseEventFilters: () => Promise.resolve(true),
        updateSource: (_userId, _sourceId, updates) => Promise.resolve({
          id: "source-1",
          ...updates,
        }),
      },
    );

    expect(response.status).toBe(200);
  });
});
