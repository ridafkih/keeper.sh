import { describe, expect, it } from "vitest";
import { handlePatchSourceRoute } from "../../../../../src/routes/api/sources/[id]/source-item-routes";

const readJson = (response: Response): Promise<unknown> => response.json();

type Dependencies = Parameters<typeof handlePatchSourceRoute>[1];

const makeDependencies = (overrides: Partial<Dependencies> = {}): Dependencies => ({
  canUseEventFilters: () => Promise.resolve(true),
  setPaused: () => Promise.reject(new Error("should not be called")),
  updateSource: (_userId, _sourceId, updates) => Promise.resolve({ id: "source-1", ...updates }),
  ...overrides,
});

describe("handlePatchSourceRoute", () => {
  it("returns 400 when id param is missing", async () => {
    const response = await handlePatchSourceRoute(
      { body: {}, params: {}, userId: "user-1" },
      makeDependencies({ updateSource: () => Promise.resolve(null) }),
    );

    expect(response.status).toBe(400);
  });

  it("returns 400 when no valid fields are provided", async () => {
    const response = await handlePatchSourceRoute(
      { body: { unknown: true }, params: { id: "source-1" }, userId: "user-1" },
      makeDependencies({ updateSource: () => Promise.resolve(null) }),
    );

    expect(response.status).toBe(400);
  });

  it("returns 404 when source update target is missing", async () => {
    const response = await handlePatchSourceRoute(
      { body: { name: "Updated Name" }, params: { id: "source-1" }, userId: "user-1" },
      makeDependencies({ updateSource: () => Promise.resolve(null) }),
    );

    expect(response.status).toBe(404);
  });

  it("returns updated source for valid name update", async () => {
    const response = await handlePatchSourceRoute(
      { body: { name: "Updated Name" }, params: { id: "source-1" }, userId: "user-1" },
      makeDependencies(),
    );

    expect(response.status).toBe(200);
  });

  it("no longer accepts the per-calendar copy settings syncs replaced", async () => {
    const updates: unknown[] = [];
    const legacy = [
      { customEventName: "{{calendar_name}}" },
      { excludeEventDescription: true },
      { markEventsAsPrivate: true },
    ];
    for (const body of legacy) {
      const response = await handlePatchSourceRoute(
        { body, params: { id: "source-1" }, userId: "user-1" },
        makeDependencies({
          updateSource: (_userId, _sourceId, received) => {
            updates.push(received);
            return Promise.resolve({ id: "source-1" });
          },
        }),
      );
      expect(response.status).toBe(400);
    }
    expect(updates).toEqual([]);
  });

  it("returns 403 when free users update full-day timed event interpretation", async () => {
    const response = await handlePatchSourceRoute(
      { body: { treatFullDayTimedEventsAsAllDay: true }, params: { id: "source-1" }, userId: "user-1" },
      makeDependencies({ canUseEventFilters: () => Promise.resolve(false) }),
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
      makeDependencies({
        updateSource: (_userId, _sourceId, updates) => {
          receivedUpdates = updates;
          return Promise.resolve({ id: "source-1", ...updates });
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(receivedUpdates).toEqual({
      syncFutureRange: "12_months",
      syncHistoricRange: "3_months",
    });
  });

  it("resumes a paused calendar on any plan through the pause helper", async () => {
    const paused: unknown[] = [];
    const response = await handlePatchSourceRoute(
      { body: { paused: false }, params: { id: "source-1" }, userId: "user-1" },
      makeDependencies({
        canUseEventFilters: () => Promise.resolve(false),
        setPaused: (userId, calendarId, value) => {
          paused.push({ calendarId, userId, value });
          return Promise.resolve({ calendarId, paused: value });
        },
        updateSource: () => Promise.reject(new Error("should not be called")),
      }),
    );

    expect(response.status).toBe(200);
    expect(await readJson(response)).toEqual({ calendarId: "source-1", paused: false });
    expect(paused).toEqual([{ calendarId: "source-1", userId: "user-1", value: false }]);
  });

  it("applies a pause alongside other fields and returns the updated calendar", async () => {
    const response = await handlePatchSourceRoute(
      { body: { name: "Work", paused: true }, params: { id: "source-1" }, userId: "user-1" },
      makeDependencies({ setPaused: (_userId, calendarId, value) => Promise.resolve({ calendarId, paused: value }) }),
    );

    expect(await readJson(response)).toEqual({ id: "source-1", name: "Work" });
  });

  it("404s a pause for a calendar the user doesn't own", async () => {
    const response = await handlePatchSourceRoute(
      { body: { paused: true }, params: { id: "source-9" }, userId: "user-1" },
      makeDependencies({ setPaused: () => Promise.resolve(null) }),
    );

    expect(response.status).toBe(404);
  });
});
