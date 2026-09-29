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
import { SyncConflictError, SyncLimitError, SyncNotFoundError, SyncValidationError } from "../../src/utils/syncs";

const USER_ID = "user-1";

const detail: SyncDetail = {
  ...DEFAULT_SYNC_SETTINGS,
  copiedCount: 0,
  createdAt: "2026-09-27T00:00:00.000Z",
  destinationCalendarIds: ["personal"],
  destinations: [],
  id: "sync-1",
  lastSyncedAt: null,
  memberCalendarIds: [],
  mode: "one_way",
  name: "Work Blocks Personal",
  pairCount: 1,
  paused: false,
  skippedCount: 0,
  sourceCalendarIds: ["work"],
  state: "ok",
  updatedAt: "2026-09-27T00:00:00.000Z",
};

const findSync = () => Promise.resolve(detail);
const rejectUpdate = () => Promise.reject(new Error("should not be called"));
const validBody = { destinationCalendarIds: ["personal"], mode: "one_way", name: "Work Blocks Personal", sourceCalendarIds: ["work"] };

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
      createSync: () => Promise.resolve("sync-1"),
      findSync,
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ id: "sync-1", name: "Work Blocks Personal" });
  });

  it("returns the conflicting pairs with a 409", async () => {
    const conflicts = [{ destinationCalendarId: "personal", sourceCalendarId: "work", syncId: "sync-2", syncName: "Other" }];
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
    const response = await handleGetSyncRoute({ params: { id: "sync-9" }, userId: USER_ID }, { findSync: () => Promise.resolve(null) });
    expect(response.status).toBe(404);
  });
});

describe("handlePatchSyncRoute", () => {
  it("rejects an empty or unknown patch", async () => {
    const empty = await handlePatchSyncRoute({ body: {}, params: { id: "sync-1" }, userId: USER_ID }, { findSync, updateSync: rejectUpdate });
    const unknown = await handlePatchSyncRoute(
      { body: { ruleIds: [] }, params: { id: "sync-1" }, userId: USER_ID },
      { findSync, updateSync: rejectUpdate },
    );
    expect(empty.status).toBe(400);
    expect(unknown.status).toBe(400);
  });

  it("returns the updated sync", async () => {
    const updates: unknown[] = [];
    const response = await handlePatchSyncRoute({ body: { paused: true }, params: { id: "sync-1" }, userId: USER_ID }, {
      findSync,
      updateSync: (_userId, _syncId, body) => {
        updates.push(body);
        return Promise.resolve();
      },
    });
    expect(response.status).toBe(200);
    expect(updates).toEqual([{ paused: true }]);
  });
});

describe("handleDeleteSyncRoute", () => {
  it("returns 204, or 404 when the sync is missing", async () => {
    const deleted = await handleDeleteSyncRoute({ params: { id: "sync-1" }, userId: USER_ID }, { deleteSync: () => Promise.resolve() });
    const missing = await handleDeleteSyncRoute({ params: { id: "sync-9" }, userId: USER_ID }, {
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
      { params: { id: "sync-9" }, searchParams: new URLSearchParams(), userId: USER_ID },
      { listActivity, syncExists: () => Promise.resolve(false) },
    );
    const shown = await handleSyncActivityRoute(
      { params: { id: "sync-1" }, searchParams: new URLSearchParams("before=cursor&limit=20"), userId: USER_ID },
      { listActivity, syncExists: () => Promise.resolve(true) },
    );
    expect(hidden.status).toBe(404);
    expect(shown.status).toBe(200);
    expect(reads).toEqual([{ before: "cursor", limit: 20 }]);
  });
});
