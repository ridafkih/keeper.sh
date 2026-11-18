import { describe, expect, it } from "vitest";
import { handlePatchSourceRoute } from "../../../../../src/routes/api/sources/[id]/source-item-routes";

const readJson = (response: Response): Promise<unknown> => response.json();

const OUTLOOK_SOURCE = { excludeAvailabilities: [], provider: "outlook" };

describe("handlePatchSourceRoute", () => {
  it("returns 400 when id param is missing", async () => {
    const response = await handlePatchSourceRoute(
      { body: {}, params: {}, userId: "user-1" },
      {
        canUseEventFilters: () => Promise.resolve(true),
        getSourceExclusionState: () => Promise.resolve(OUTLOOK_SOURCE),
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
        getSourceExclusionState: () => Promise.resolve(OUTLOOK_SOURCE),
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
        getSourceExclusionState: () => Promise.resolve(OUTLOOK_SOURCE),
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
        getSourceExclusionState: () => Promise.resolve(OUTLOOK_SOURCE),
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
        getSourceExclusionState: () => Promise.resolve(OUTLOOK_SOURCE),
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
        getSourceExclusionState: () => Promise.resolve(OUTLOOK_SOURCE),
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
        getSourceExclusionState: () => Promise.resolve(OUTLOOK_SOURCE),
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

  it("passes sync range updates through for Pro users", async () => {
    let receivedUpdates: Record<string, unknown> = {};
    const response = await handlePatchSourceRoute(
      {
        body: { syncFutureRange: "12_months", syncHistoricRange: "3_months" },
        params: { id: "source-1" },
        userId: "user-1",
      },
      {
        canUseEventFilters: () => Promise.resolve(true),
        getSourceExclusionState: () => Promise.resolve(OUTLOOK_SOURCE),
        updateSource: (_userId, _sourceId, updates) => {
          receivedUpdates = updates;
          return Promise.resolve({ id: "source-1", ...updates });
        },
      },
    );

    expect(response.status).toBe(200);
    expect(receivedUpdates).toEqual({
      syncFutureRange: "12_months",
      syncHistoricRange: "3_months",
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
        getSourceExclusionState: () => Promise.resolve(OUTLOOK_SOURCE),
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
        getSourceExclusionState: () => Promise.resolve(OUTLOOK_SOURCE),
        updateSource: (_userId, _sourceId, updates) => Promise.resolve({
          id: "source-1",
          ...updates,
        }),
      },
    );

    expect(response.status).toBe(200);
  });

  it("returns 403 when free users try to disable reminders on copies", async () => {
    const response = await handlePatchSourceRoute(
      {
        body: { disableEventReminders: true },
        params: { id: "source-1" },
        userId: "user-1",
      },
      {
        canUseEventFilters: () => Promise.resolve(false),
        getSourceExclusionState: () => Promise.resolve(OUTLOOK_SOURCE),
        updateSource: () => Promise.resolve(null),
      },
    );

    expect(response.status).toBe(403);
  });

  it("saves disabled reminders when a pro user turns them off on copies", async () => {
    let receivedUpdates: Record<string, unknown> = {};
    const response = await handlePatchSourceRoute(
      {
        body: { disableEventReminders: true },
        params: { id: "source-1" },
        userId: "user-1",
      },
      {
        canUseEventFilters: () => Promise.resolve(true),
        getSourceExclusionState: () => Promise.resolve(OUTLOOK_SOURCE),
        updateSource: (_userId, _sourceId, updates) => {
          receivedUpdates = updates;
          return Promise.resolve({ id: "source-1", ...updates });
        },
      },
    );

    expect(response.status).toBe(200);
    expect(receivedUpdates).toEqual({ disableEventReminders: true });
  });

  it("returns 403 when free users set title keywords", async () => {
    const response = await handlePatchSourceRoute(
      {
        body: { excludeTitleKeywords: ["zoom room"] },
        params: { id: "source-1" },
        userId: "user-1",
      },
      {
        canUseEventFilters: () => Promise.resolve(false),
        getSourceExclusionState: () => Promise.resolve(OUTLOOK_SOURCE),
        updateSource: () => Promise.resolve(null),
      },
    );

    expect(response.status).toBe(403);
  });

  it("returns 403 when free users set excluded statuses", async () => {
    const response = await handlePatchSourceRoute(
      {
        body: { excludeAvailabilities: ["free"] },
        params: { id: "source-1" },
        userId: "user-1",
      },
      {
        canUseEventFilters: () => Promise.resolve(false),
        getSourceExclusionState: () => Promise.resolve(OUTLOOK_SOURCE),
        updateSource: () => Promise.resolve(null),
      },
    );

    expect(response.status).toBe(403);
  });

  it("de-duplicates excluded statuses for Pro users", async () => {
    const response = await handlePatchSourceRoute(
      {
        body: { excludeAvailabilities: ["free", "free"] },
        params: { id: "source-1" },
        userId: "user-1",
      },
      {
        canUseEventFilters: () => Promise.resolve(true),
        getSourceExclusionState: () => Promise.resolve(OUTLOOK_SOURCE),
        updateSource: (_userId, _sourceId, updates) => Promise.resolve({ id: "source-1", ...updates }),
      },
    );

    expect(await readJson(response)).toEqual({ excludeAvailabilities: ["free"], id: "source-1" });
  });

  it("trims, drops blank and de-duplicates title keywords ignoring case", async () => {
    const response = await handlePatchSourceRoute(
      {
        body: { excludeTitleKeywords: ["  Zoom Room ", "zoom room", "   ", "Placeholder"] },
        params: { id: "source-1" },
        userId: "user-1",
      },
      {
        canUseEventFilters: () => Promise.resolve(true),
        getSourceExclusionState: () => Promise.resolve(OUTLOOK_SOURCE),
        updateSource: (_userId, _sourceId, updates) => Promise.resolve({ id: "source-1", ...updates }),
      },
    );

    expect(await readJson(response)).toEqual({
      excludeTitleKeywords: ["Zoom Room", "Placeholder"],
      id: "source-1",
    });
  });

  it("clears excluded statuses with an empty list", async () => {
    const response = await handlePatchSourceRoute(
      {
        body: { excludeAvailabilities: [] },
        params: { id: "source-1" },
        userId: "user-1",
      },
      {
        canUseEventFilters: () => Promise.resolve(true),
        getSourceExclusionState: () => Promise.resolve(OUTLOOK_SOURCE),
        updateSource: (_userId, _sourceId, updates) => Promise.resolve({ id: "source-1", ...updates }),
      },
    );

    expect(await readJson(response)).toEqual({ excludeAvailabilities: [], id: "source-1" });
  });

  it("clears title keywords with an empty list", async () => {
    const response = await handlePatchSourceRoute(
      {
        body: { excludeTitleKeywords: [] },
        params: { id: "source-1" },
        userId: "user-1",
      },
      {
        canUseEventFilters: () => Promise.resolve(true),
        getSourceExclusionState: () => Promise.resolve(OUTLOOK_SOURCE),
        updateSource: (_userId, _sourceId, updates) => Promise.resolve({ id: "source-1", ...updates }),
      },
    );

    expect(await readJson(response)).toEqual({ excludeTitleKeywords: [], id: "source-1" });
  });
});

describe("handlePatchSourceRoute excluded statuses", () => {
  const patchWith = (
    body: Record<string, unknown>,
    source: { excludeAvailabilities: string[]; provider: string } | null,
  ) => handlePatchSourceRoute(
    { body, params: { id: "source-1" }, userId: "user-1" },
    {
      canUseEventFilters: () => Promise.resolve(true),
      getSourceExclusionState: () => Promise.resolve(source),
      updateSource: (_userId, _sourceId, updates) => Promise.resolve({ id: "source-1", ...updates }),
    },
  );

  it("rejects a status the calendar's provider does not report", async () => {
    const response = await patchWith(
      { excludeAvailabilities: ["tentative"] },
      { excludeAvailabilities: [], provider: "google" },
    );

    expect(response.status).toBe(400);
  });

  it("returns 404 when the calendar does not exist", async () => {
    const response = await patchWith({ excludeAvailabilities: ["free"] }, null);

    expect(response.status).toBe(404);
  });

  it("adds free to the stored statuses for a client that still sends excludeFreeEvents", async () => {
    const response = await patchWith(
      { excludeFreeEvents: true },
      { excludeAvailabilities: ["tentative"], provider: "outlook" },
    );

    expect(await readJson(response)).toEqual({
      excludeAvailabilities: ["tentative", "free"],
      id: "source-1",
    });
  });

  it("removes free from the stored statuses for a client that still sends excludeFreeEvents", async () => {
    const response = await patchWith(
      { excludeFreeEvents: false },
      { excludeAvailabilities: ["free", "tentative"], provider: "outlook" },
    );

    expect(await readJson(response)).toEqual({
      excludeAvailabilities: ["tentative"],
      id: "source-1",
    });
  });

  it("returns 403 when free users send excludeFreeEvents", async () => {
    const response = await handlePatchSourceRoute(
      { body: { excludeFreeEvents: true }, params: { id: "source-1" }, userId: "user-1" },
      {
        canUseEventFilters: () => Promise.resolve(false),
        getSourceExclusionState: () => Promise.resolve(OUTLOOK_SOURCE),
        updateSource: () => Promise.resolve(null),
      },
    );

    expect(response.status).toBe(403);
  });
});
