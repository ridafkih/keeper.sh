import { beforeAll, describe, expect, it, vi } from "vitest";
import type { SyncDefinition } from "@keeper.sh/data-schemas";
import type {
  SyncCopiesDependencies,
  SyncCopy,
  handleSyncCopiesRoute as handleSyncCopiesRouteFn,
} from "../../../../src/routes/api/syncs/[id]/copies";

let handleSyncCopiesRoute: typeof handleSyncCopiesRouteFn = () => Promise.reject(new Error("Module not loaded"));

vi.mock("../../../../src/utils/middleware", () => ({
  withAuth: (handler: unknown) => handler,
  withWideEvent: (handler: unknown) => handler,
}));
vi.mock("../../../../src/context", () => ({ database: {} }));
vi.mock("../../../../src/utils/syncs", () => ({ findSyncForUser: () => Promise.resolve(null) }));

beforeAll(async () => {
  ({ handleSyncCopiesRoute } = await import("../../../../src/routes/api/syncs/[id]/copies"));
});

const BOTH_WAYS = {
  destinationCalendarIds: [],
  memberCalendarIds: ["work", "personal"],
  mode: "both_ways",
  sourceCalendarIds: [],
} as unknown as SyncDefinition;

const copy = (id: string, sourceCalendarId: string, destinationCalendarId: string): SyncCopy => ({
  destinationCalendarId,
  endTime: "2026-10-02T10:00:00.000Z",
  id,
  isAllDay: false,
  sourceCalendarId,
  startTime: "2026-10-02T09:00:00.000Z",
  title: "Standup",
});

describe("GET /api/syncs/:id/copies", () => {
  it("reads copies into every calendar of a both-ways sync", async () => {
    const queries: unknown[] = [];
    const dependencies: SyncCopiesDependencies = {
      findSync: () => Promise.resolve(BOTH_WAYS),
      listCopies: (destinationIds, sourceIds, limit) => {
        queries.push({ destinationIds, limit, sourceIds });
        return Promise.resolve([copy("a", "work", "personal"), copy("b", "personal", "personal")]);
      },
    };
    const response = await handleSyncCopiesRoute({ limit: "5", syncId: "sync-1", userId: "user-1" }, dependencies);

    expect(queries).toEqual([{ destinationIds: ["work", "personal"], limit: 5, sourceIds: ["work", "personal"] }]);
    expect(await response.json()).toEqual({ copies: [copy("a", "work", "personal")] });
  });

  it("does not show another person's sync", async () => {
    const response = await handleSyncCopiesRoute({ limit: null, syncId: "sync-1", userId: "user-1" }, {
      findSync: () => Promise.resolve(null),
      listCopies: () => Promise.resolve([]),
    });

    expect(response.status).toBe(404);
  });
});
