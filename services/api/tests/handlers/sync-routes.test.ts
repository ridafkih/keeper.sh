import { describe, expect, it } from "vitest";
import { DEFAULT_SYNC_SETTINGS } from "@keeper.sh/data-schemas";
import type { SyncDetail } from "@keeper.sh/data-schemas";
import {
  handleCreateSyncRoute,
  handleDeleteSyncRoute,
  handleGetSyncRoute,
  handlePatchSyncRoute,
  handleSyncActivityRoute,
} from "../../src/handlers/sync-routes";
import { SyncConflictError, SyncLimitError, SyncNotFoundError, SyncStaleError, SyncValidationError } from "../../src/utils/syncs";

const USER_ID = "user-1";
const SYNC_ID = "0d6f1a52-3b8e-4c2a-9f71-5e4d3c2b1a01";
const OTHER_SYNC_ID = "0d6f1a52-3b8e-4c2a-9f71-5e4d3c2b1a09";
const WORK = "1a6f1a52-3b8e-4c2a-9f71-5e4d3c2b1a01";
const PERSONAL = "1a6f1a52-3b8e-4c2a-9f71-5e4d3c2b1a02";
const CURSOR = "2026-10-06T09:00:00.123456Z_3a6f1a52-3b8e-4c2a-9f71-5e4d3c2b1a01";

const detail: SyncDetail = {
  ...DEFAULT_SYNC_SETTINGS,
  copiedCount: 0,
  createdAt: "2026-09-27T00:00:00.000Z",
  destinationCalendarIds: [PERSONAL],
  destinations: [],
  id: SYNC_ID,
  lastSyncedAt: null,
  memberCalendarIds: [],
  mode: "one_way",
  name: "Work Blocks Personal",
  pairCount: 1,
  paused: false,
  skippedCount: 0,
  sourceCalendarIds: [WORK],
  sources: [],
  state: "ok",
  updatedAt: "2026-09-27T00:00:00.000Z",
};

const findSync = () => Promise.resolve(detail);
const rejectUpdate = () => Promise.reject(new Error("should not be called"));
const validBody = { destinationCalendarIds: [PERSONAL], mode: "one_way", name: "Work Blocks Personal", sourceCalendarIds: [WORK] };

describe("handleCreateSyncRoute", () => {
  it("rejects a body that isn't a sync", async () => {
    const response = await handleCreateSyncRoute({ body: { name: "x" }, userId: USER_ID }, {
      createSync: () => Promise.reject(new Error("should not be called")),
      findSync,
    });
    expect(response.status).toBe(400);
  });

  it("creates the sync and returns it", async () => {
    const response = await handleCreateSyncRoute({ body: validBody, userId: USER_ID }, {
      createSync: () => Promise.resolve(SYNC_ID),
      findSync,
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ id: SYNC_ID, name: "Work Blocks Personal" });
  });

  it("rejects calendar ids that aren't ids before anything reads them", async () => {
    const response = await handleCreateSyncRoute({ body: { ...validBody, sourceCalendarIds: ["x"] }, userId: USER_ID }, {
      createSync: () => Promise.reject(new Error("should not be called")),
      findSync,
    });
    expect(response.status).toBe(400);
  });

  it("returns the conflicting pairs with a 409", async () => {
    const conflicts = [{ destinationCalendarId: PERSONAL, sourceCalendarId: WORK, syncId: OTHER_SYNC_ID, syncName: "Other" }];
    const response = await handleCreateSyncRoute({ body: validBody, userId: USER_ID }, {
      createSync: () => Promise.reject(new SyncConflictError(conflicts)),
      findSync,
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ conflicts });
  });

  it("maps plan limits to 403 and validation to 400", async () => {
    const limited = await handleCreateSyncRoute({ body: validBody, userId: USER_ID }, {
      createSync: () => Promise.reject(new SyncLimitError("limit")),
      findSync,
    });
    const invalid = await handleCreateSyncRoute({ body: validBody, userId: USER_ID }, {
      createSync: () => Promise.reject(new SyncValidationError("bad")),
      findSync,
    });
    expect(limited.status).toBe(403);
    expect(invalid.status).toBe(400);
  });
});

describe("handleGetSyncRoute", () => {
  it("404s a sync the user doesn't own", async () => {
    const response = await handleGetSyncRoute({ params: { id: OTHER_SYNC_ID }, userId: USER_ID }, { findSync: () => Promise.resolve(null) });
    expect(response.status).toBe(404);
  });

  it("404s an id that isn't a uuid without querying", async () => {
    const response = await handleGetSyncRoute({ params: { id: "abc" }, userId: USER_ID }, {
      findSync: () => Promise.reject(new Error("should not be called")),
    });
    expect(response.status).toBe(404);
  });

  it("reads the id when the router repeats it as an array", async () => {
    const reads: string[] = [];
    const response = await handleGetSyncRoute({ params: { id: [SYNC_ID, SYNC_ID] }, userId: USER_ID }, {
      findSync: (_userId, syncId) => {
        reads.push(syncId);
        return findSync();
      },
    });
    expect(response.status).toBe(200);
    expect(reads).toEqual([SYNC_ID]);
  });
});

describe("handlePatchSyncRoute", () => {
  it("rejects an empty or unknown patch", async () => {
    const empty = await handlePatchSyncRoute({ body: {}, params: { id: SYNC_ID }, userId: USER_ID }, { findSync, updateSync: rejectUpdate });
    const unknown = await handlePatchSyncRoute(
      { body: { ruleIds: [] }, params: { id: SYNC_ID }, userId: USER_ID },
      { findSync, updateSync: rejectUpdate },
    );
    expect(empty.status).toBe(400);
    expect(unknown.status).toBe(400);
  });

  it("returns the updated sync", async () => {
    const updates: unknown[] = [];
    const response = await handlePatchSyncRoute({ body: { paused: true }, params: { id: SYNC_ID }, userId: USER_ID }, {
      findSync,
      updateSync: (_userId, _syncId, body) => {
        updates.push(body);
        return Promise.resolve();
      },
    });
    expect(response.status).toBe(200);
    expect(updates).toEqual([{ paused: true }]);
  });

  it("answers a stale save with a 409 the web can tell apart from a conflict", async () => {
    const response = await handlePatchSyncRoute(
      { body: { expectedUpdatedAt: "2026-09-27T00:00:00.000Z", name: "Late" }, params: { id: SYNC_ID }, userId: USER_ID },
      { findSync, updateSync: () => Promise.reject(new SyncStaleError("This sync changed since you opened it.")) },
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "This sync changed since you opened it.", stale: true });
  });

  it("rejects malformed ids before updating", async () => {
    const badSync = await handlePatchSyncRoute({ body: { paused: true }, params: { id: "abc" }, userId: USER_ID }, { findSync, updateSync: rejectUpdate });
    const badCalendar = await handlePatchSyncRoute(
      { body: { memberCalendarIds: [WORK, "nope"] }, params: { id: SYNC_ID }, userId: USER_ID },
      { findSync, updateSync: rejectUpdate },
    );
    expect(badSync.status).toBe(404);
    expect(badCalendar.status).toBe(400);
  });
});

describe("handleDeleteSyncRoute", () => {
  it("returns 204, or 404 when the sync is missing", async () => {
    const deleted = await handleDeleteSyncRoute({ params: { id: SYNC_ID }, userId: USER_ID }, { deleteSync: () => Promise.resolve() });
    const missing = await handleDeleteSyncRoute({ params: { id: OTHER_SYNC_ID }, userId: USER_ID }, {
      deleteSync: () => Promise.reject(new SyncNotFoundError("Sync not found.")),
    });
    expect(deleted.status).toBe(204);
    expect(missing.status).toBe(404);
  });
});

describe("handleSyncActivityRoute", () => {
  it("only reads activity for the user's own sync, passing the cursor through", async () => {
    const reads: unknown[] = [];
    const listActivity = (_syncId: string, options: unknown) => {
      reads.push(options);
      return Promise.resolve({ entries: [], nextCursor: null, summary: null });
    };
    const hidden = await handleSyncActivityRoute(
      { params: { id: OTHER_SYNC_ID }, searchParams: new URLSearchParams(), userId: USER_ID },
      { listActivity, syncExists: () => Promise.resolve(false) },
    );
    const shown = await handleSyncActivityRoute(
      { params: { id: SYNC_ID }, searchParams: new URLSearchParams({ before: CURSOR, limit: "20" }), userId: USER_ID },
      { listActivity, syncExists: () => Promise.resolve(true) },
    );
    expect(hidden.status).toBe(404);
    expect(shown.status).toBe(200);
    expect(reads).toEqual([{ before: CURSOR, limit: 20 }]);
  });

  it("rejects a cursor that isn't one, rather than letting Postgres fail on it", async () => {
    for (const before of ["cursor", "2026-10-06T00:00:00Z_x", `2026-13-45T99:99:99Z_${SYNC_ID}`]) {
      const response = await handleSyncActivityRoute(
        { params: { id: SYNC_ID }, searchParams: new URLSearchParams({ before }), userId: USER_ID },
        { listActivity: rejectUpdate, syncExists: () => Promise.resolve(true) },
      );
      expect(response.status).toBe(400);
    }
  });
});
