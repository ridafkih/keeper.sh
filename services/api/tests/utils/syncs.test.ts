import { describe, expect, it } from "vitest";
import type { SyncConflict, SyncDefinition, SyncPair } from "@keeper.sh/data-schemas";
import {
  SyncConflictError,
  SyncContentNotAllowedError,
  SyncLimitError,
  SyncNotFoundError,
  SyncValidationError,
  runCreateSync,
  runUpdateSync,
} from "../../src/utils/syncs";
import type { SyncWriteDependencies, SyncWriteTransaction } from "../../src/utils/syncs";

const USER_ID = "user-1";
const PULL_PUSH = ["pull", "push"];

interface StoredPair extends SyncPair {
  id: string;
  syncId: string;
}

interface FakeStoreOptions {
  calendars?: Record<string, string[]>;
  pro?: boolean;
  syncLimit?: number;
}

const createFakeStore = (options: FakeStoreOptions = {}) => {
  const calendars = options.calendars ?? { family: PULL_PUSH, feed: ["pull"], personal: PULL_PUSH, school: PULL_PUSH, work: PULL_PUSH };
  const syncs = new Map<string, SyncDefinition>();
  const pairs: StoredPair[] = [];
  const activity: { kind: string; syncId: string }[] = [];
  const log: string[] = [];
  let nextId = 1;

  const transaction: SyncWriteTransaction = {
    acquireUserLock: () => {
      log.push("lock");
      return Promise.resolve();
    },
    countUserSyncs: () => Promise.resolve(syncs.size),
    ensureDestinationSyncStatuses: () => Promise.resolve(),
    findOwnedCalendars: (_userId, calendarIds) => Promise.resolve(calendarIds
      .filter((id) => id in calendars)
      .map((id) => ({ capabilities: calendars[id] ?? [], id }))),
    findPairConflicts: (syncId, wanted) => Promise.resolve(pairs
      .filter((pair) => pair.syncId !== syncId && wanted.some((candidate) =>
        candidate.sourceCalendarId === pair.sourceCalendarId && candidate.destinationCalendarId === pair.destinationCalendarId))
      .map((pair): SyncConflict => ({
        destinationCalendarId: pair.destinationCalendarId,
        sourceCalendarId: pair.sourceCalendarId,
        syncId: pair.syncId,
        syncName: syncs.get(pair.syncId)?.name ?? "",
      }))),
    findSync: (_userId, syncId) => Promise.resolve(syncs.get(syncId) ?? null),
    insertActivity: (syncId, changes) => {
      activity.push(...changes.map((change) => ({ kind: change.kind, syncId })));
      return Promise.resolve();
    },
    insertSync: (_userId, definition) => {
      const syncId = `sync-${nextId++}`;
      syncs.set(syncId, definition);
      return Promise.resolve(syncId);
    },
    replaceSyncCalendars: () => Promise.resolve(),
    replaceSyncPairs: (syncId, wanted) => {
      log.push("pairs");
      const keep = pairs.filter((pair) => pair.syncId !== syncId || wanted.some((candidate) =>
        candidate.sourceCalendarId === pair.sourceCalendarId && candidate.destinationCalendarId === pair.destinationCalendarId));
      const added = wanted.filter((candidate) => !keep.some((pair) => pair.syncId === syncId
        && pair.sourceCalendarId === candidate.sourceCalendarId && pair.destinationCalendarId === candidate.destinationCalendarId));
      pairs.splice(0, pairs.length, ...keep, ...added.map((pair) => ({ ...pair, id: `pair-${nextId++}`, syncId })));
      return Promise.resolve();
    },
    requestUserSync: () => {
      log.push("request-sync");
      return Promise.resolve();
    },
    updateSync: (syncId, definition) => {
      syncs.set(syncId, definition);
      return Promise.resolve();
    },
  };

  const dependencies: SyncWriteDependencies = {
    canAddSync: (_userId, currentCount) => Promise.resolve(currentCount < (options.syncLimit ?? Number.POSITIVE_INFINITY)),
    canUseEventFilters: () => Promise.resolve(options.pro ?? true),
    withTransaction: (callback) => callback(transaction),
  };

  return { activity, dependencies, log, pairs, syncs };
};

describe("runCreateSync", () => {
  it("links every ordered pair of a both-ways sync and asks for a sync run", async () => {
    const store = createFakeStore();
    const syncId = await runCreateSync(USER_ID, {
      memberCalendarIds: ["work", "personal", "family"],
      mode: "both_ways",
      name: "Block My Time",
    }, store.dependencies);

    expect(store.pairs.filter((pair) => pair.syncId === syncId)).toHaveLength(6);
    expect(store.activity).toEqual([{ kind: "created", syncId }]);
    expect(store.log.at(-1)).toBe("request-sync");
  });

  it("refuses pairs another sync already owns and names that sync", async () => {
    const store = createFakeStore();
    await runCreateSync(USER_ID, { destinationCalendarIds: ["personal"], mode: "one_way", name: "Work Blocks Personal", sourceCalendarIds: ["work"] }, store.dependencies);

    const creating = runCreateSync(USER_ID, { memberCalendarIds: ["work", "personal"], mode: "both_ways", name: "Block My Time" }, store.dependencies);

    await expect(creating).rejects.toBeInstanceOf(SyncConflictError);
    await expect(creating).rejects.toMatchObject({
      conflicts: [{ destinationCalendarId: "personal", sourceCalendarId: "work", syncName: "Work Blocks Personal" }],
    });
  });

  it("rejects calendars that can't play their role", async () => {
    const store = createFakeStore();
    await expect(runCreateSync(USER_ID, {
      destinationCalendarIds: ["feed"],
      mode: "one_way",
      name: "Into a feed",
      sourceCalendarIds: ["work"],
    }, store.dependencies)).rejects.toBeInstanceOf(SyncValidationError);
    await expect(runCreateSync(USER_ID, {
      destinationCalendarIds: ["personal"],
      mode: "one_way",
      name: "Someone else's",
      sourceCalendarIds: ["not-mine"],
    }, store.dependencies)).rejects.toBeInstanceOf(SyncValidationError);
  });

  it("keeps free plans to one busy-only sync", async () => {
    const store = createFakeStore({ pro: false, syncLimit: 1 });

    await expect(runCreateSync(USER_ID, {
      destinationCalendarIds: ["personal"],
      mode: "one_way",
      name: "Titles",
      shareAs: "title_only",
      sourceCalendarIds: ["work"],
    }, store.dependencies)).rejects.toBeInstanceOf(SyncContentNotAllowedError);

    await runCreateSync(USER_ID, { memberCalendarIds: ["work", "personal"], mode: "both_ways", name: "Block" }, store.dependencies);
    await expect(runCreateSync(USER_ID, {
      memberCalendarIds: ["school", "family"],
      mode: "both_ways",
      name: "Another",
    }, store.dependencies)).rejects.toBeInstanceOf(SyncLimitError);
  });
});

describe("runUpdateSync", () => {
  const seed = async (options: FakeStoreOptions = {}) => {
    const store = createFakeStore(options);
    const syncId = await runCreateSync(USER_ID, {
      destinationCalendarIds: ["personal"],
      mode: "one_way",
      name: "Work Blocks Personal",
      sourceCalendarIds: ["work"],
    }, store.dependencies);
    store.log.length = 0;
    store.activity.length = 0;
    return { store, syncId };
  };

  it("keeps existing pairs, adds new ones and logs the added calendar", async () => {
    const { store, syncId } = await seed();
    const [original] = store.pairs;

    await runUpdateSync(USER_ID, syncId, { sourceCalendarIds: ["work", "school"] }, store.dependencies);

    expect(store.pairs.map((pair) => pair.sourceCalendarId)).toEqual(["work", "school"]);
    expect(store.pairs[0]?.id).toBe(original?.id);
    expect(store.activity).toEqual([{ kind: "calendar_added", syncId }]);
    expect(store.log).toContain("request-sync");
  });

  it("renames without touching pairs or asking for a sync run", async () => {
    const { store, syncId } = await seed();

    await runUpdateSync(USER_ID, syncId, { name: "Work Hours" }, store.dependencies);

    expect(store.syncs.get(syncId)?.name).toBe("Work Hours");
    expect(store.log).toEqual(["lock"]);
  });

  it("lets a free plan keep Pro settings it already has but not change them", async () => {
    const { store, syncId } = await seed({ pro: false });
    store.syncs.set(syncId, { ...store.syncs.get(syncId) as SyncDefinition, shareAs: "title_only" });

    await expect(runUpdateSync(USER_ID, syncId, { paused: true }, store.dependencies)).resolves.toEqual([{ kind: "paused" }]);
    await expect(runUpdateSync(USER_ID, syncId, { shareAs: "full" }, store.dependencies))
      .rejects.toBeInstanceOf(SyncContentNotAllowedError);
    await expect(runUpdateSync(USER_ID, syncId, { shareAs: "busy_only" }, store.dependencies)).resolves.toHaveLength(1);
  });

  it("switches mode by replacing the calendars with members", async () => {
    const { store, syncId } = await seed();

    await runUpdateSync(USER_ID, syncId, { memberCalendarIds: ["work", "personal"], mode: "both_ways" }, store.dependencies);

    expect(store.syncs.get(syncId)).toMatchObject({ destinationCalendarIds: [], mode: "both_ways", sourceCalendarIds: [] });
    expect(store.pairs).toHaveLength(2);
  });

  it("reports a sync that doesn't exist", async () => {
    const store = createFakeStore();
    await expect(runUpdateSync(USER_ID, "missing", { name: "x" }, store.dependencies)).rejects.toBeInstanceOf(SyncNotFoundError);
  });

  it("saves nothing when nothing changed", async () => {
    const { store, syncId } = await seed();
    await expect(runUpdateSync(USER_ID, syncId, { name: "Work Blocks Personal" }, store.dependencies)).resolves.toEqual([]);
    expect(store.activity).toEqual([]);
  });
});
