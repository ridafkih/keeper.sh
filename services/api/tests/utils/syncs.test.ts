import { describe, expect, it } from "vitest";
import type { PatchSyncBody, SyncConflict, SyncDefinition, SyncPair } from "@keeper.sh/data-schemas";
import {
  SyncConflictError,
  SyncContentNotAllowedError,
  SyncLimitError,
  SyncNotFoundError,
  SyncStaleError,
  SyncValidationError,
  runCreateSync,
  runLockedCreateSync,
  runLockedDeleteSync,
  runLockedUpdateSync,
  runUpdateSync,
} from "../../src/utils/syncs";
import type { SyncLockDependencies, SyncWriteDependencies, SyncWriteTransaction } from "../../src/utils/syncs";

const USER_ID = "user-1";
const OTHER_USER_ID = "user-2";
const PULL_PUSH = ["pull", "push"];
const FREE_CALENDAR_LIMIT = 3;
const RULE_ID = "6f1c2b4e-8a3d-4e5f-9a7b-1c2d3e4f5a6b";

interface StoredPair extends SyncPair {
  id: string;
  syncId: string;
}

interface StoredSyncRow {
  definition: SyncDefinition;
  updatedAt: string;
  userId: string;
}

interface FakeCalendar {
  capabilities: string[];
  userId: string;
}

interface FakeStoreOptions {
  calendars?: Record<string, FakeCalendar>;
  calendarLimit?: number;
  pro?: boolean;
  syncLimit?: number;
}

const mine = (capabilities: string[]): FakeCalendar => ({ capabilities, userId: USER_ID });

const DEFAULT_CALENDARS: Record<string, FakeCalendar> = {
  family: mine(PULL_PUSH),
  feed: mine(["pull"]),
  gym: mine(PULL_PUSH),
  personal: mine(PULL_PUSH),
  school: mine(PULL_PUSH),
  theirs: { capabilities: PULL_PUSH, userId: OTHER_USER_ID },
  travel: mine(PULL_PUSH),
  work: mine(PULL_PUSH),
};

const rule = (id: string, value: string) => ({
  actions: [{ kind: "skip" as const }],
  conditions: [{ kind: "title_contains" as const, value }],
  id,
  match: "all" as const,
  name: value,
});

const samePair = (left: SyncPair, right: SyncPair): boolean =>
  left.sourceCalendarId === right.sourceCalendarId && left.destinationCalendarId === right.destinationCalendarId;

const createFakeStore = (options: FakeStoreOptions = {}) => {
  const calendars = options.calendars ?? DEFAULT_CALENDARS;
  const syncs = new Map<string, StoredSyncRow>();
  const pairs: StoredPair[] = [];
  const activity: { kind: string; syncId: string }[] = [];
  const log: string[] = [];
  let nextId = 1;
  let clock = Date.parse("2026-10-01T00:00:00.000Z");
  const stamp = (): string => {
    clock += 1000;
    return new Date(clock).toISOString();
  };

  const transaction: SyncWriteTransaction = {
    acquireUserLock: () => {
      log.push("lock");
      return Promise.resolve();
    },
    countUserSyncs: (userId) => Promise.resolve([...syncs.values()].filter((row) => row.userId === userId).length),
    ensureDestinationSyncStatuses: () => Promise.resolve(),
    findOwnedCalendars: (userId, calendarIds) => Promise.resolve(calendarIds
      .filter((id) => calendars[id]?.userId === userId)
      .map((id) => ({ capabilities: calendars[id]?.capabilities ?? [], id }))),
    findPairConflicts: (userId, syncId, wanted) => Promise.resolve(pairs
      .filter((pair) => pair.syncId !== syncId && syncs.get(pair.syncId)?.userId === userId
        && wanted.some((candidate) => samePair(candidate, pair)))
      .map((pair): SyncConflict => ({
        destinationCalendarId: pair.destinationCalendarId,
        sourceCalendarId: pair.sourceCalendarId,
        syncId: pair.syncId,
        syncName: syncs.get(pair.syncId)?.definition.name ?? "",
      }))),
    findSync: (userId, syncId) => {
      const row = syncs.get(syncId);
      if (!row || row.userId !== userId) {
        return Promise.resolve(null);
      }
      return Promise.resolve({ ...row.definition, updatedAt: row.updatedAt });
    },
    insertActivity: (syncId, changes) => {
      activity.push(...changes.map((change) => ({ kind: change.kind, syncId })));
      return Promise.resolve();
    },
    insertSync: (userId, definition) => {
      const syncId = `sync-${nextId++}`;
      syncs.set(syncId, { definition, updatedAt: stamp(), userId });
      return Promise.resolve(syncId);
    },
    replaceSyncCalendars: () => Promise.resolve(),
    replaceSyncPairs: (syncId, wanted) => {
      log.push("pairs");
      const keep = pairs.filter((pair) => pair.syncId !== syncId || wanted.some((candidate) => samePair(candidate, pair)));
      const added = wanted.filter((candidate) => !keep.some((pair) => pair.syncId === syncId && samePair(candidate, pair)));
      pairs.splice(0, pairs.length, ...keep, ...added.map((pair) => ({ ...pair, id: `pair-${nextId++}`, syncId })));
      return Promise.resolve();
    },
    requestUserSync: () => {
      log.push("request-sync");
      return Promise.resolve();
    },
    updateSync: (syncId, definition) => {
      const row = syncs.get(syncId);
      if (row) {
        syncs.set(syncId, { ...row, definition, updatedAt: stamp() });
      }
      return Promise.resolve();
    },
  };

  const dependencies: SyncWriteDependencies = {
    canAddSync: (_userId, currentCount) => Promise.resolve(currentCount < (options.syncLimit ?? Number.POSITIVE_INFINITY)),
    canUseEventFilters: () => Promise.resolve(options.pro ?? true),
    getSyncCalendarLimit: () => Promise.resolve(options.calendarLimit ?? Number.POSITIVE_INFINITY),
    withTransaction: (callback) => callback(transaction),
  };

  const definitionOf = (syncId: string): SyncDefinition => {
    const row = syncs.get(syncId);
    if (!row) {
      throw new Error(`No sync ${syncId}`);
    }
    return row.definition;
  };

  const setDefinition = (syncId: string, changes: Partial<SyncDefinition>): void => {
    const row = syncs.get(syncId);
    if (row) {
      syncs.set(syncId, { ...row, definition: { ...row.definition, ...changes } });
    }
  };

  return { activity, definitionOf, dependencies, log, pairs, setDefinition, syncs };
};

const oneWay = (name: string, sourceCalendarIds: string[], destinationCalendarIds: string[]) =>
  ({ destinationCalendarIds, mode: "one_way" as const, name, sourceCalendarIds });

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
    await runCreateSync(USER_ID, oneWay("Work Blocks Personal", ["work"], ["personal"]), store.dependencies);

    const creating = runCreateSync(USER_ID, { memberCalendarIds: ["work", "personal"], mode: "both_ways", name: "Block My Time" }, store.dependencies);

    await expect(creating).rejects.toBeInstanceOf(SyncConflictError);
    await expect(creating).rejects.toMatchObject({
      conflicts: [{ destinationCalendarId: "personal", sourceCalendarId: "work", syncName: "Work Blocks Personal" }],
      message: "Some calendars already copy into each other through Work Blocks Personal.",
    });
  });

  it("names every sync that owns a conflicting pair", async () => {
    const store = createFakeStore();
    await runCreateSync(USER_ID, oneWay("Kids", ["work"], ["family"]), store.dependencies);
    await runCreateSync(USER_ID, oneWay("Me", ["work"], ["personal"]), store.dependencies);
    await runCreateSync(USER_ID, oneWay("Fitness", ["work"], ["gym"]), store.dependencies);

    await expect(runCreateSync(USER_ID, oneWay("Everything", ["work"], ["family", "personal", "gym"]), store.dependencies))
      .rejects.toMatchObject({ message: "Some calendars already copy into each other through Kids, Me and Fitness." });
  });

  it("rejects calendars that can't play their role", async () => {
    const store = createFakeStore();
    await expect(runCreateSync(USER_ID, oneWay("Into a feed", ["work"], ["feed"]), store.dependencies))
      .rejects.toBeInstanceOf(SyncValidationError);
    await expect(runCreateSync(USER_ID, oneWay("Unknown", ["not-there"], ["personal"]), store.dependencies))
      .rejects.toBeInstanceOf(SyncValidationError);
  });

  it("never lets a user put another user's calendar in a sync", async () => {
    const store = createFakeStore();
    await expect(runCreateSync(USER_ID, oneWay("Someone else's", ["theirs"], ["personal"]), store.dependencies))
      .rejects.toMatchObject({ message: "Some calendars were not found." });
    expect(store.pairs).toEqual([]);
  });

  it("keeps free plans to one busy-only sync", async () => {
    const store = createFakeStore({ calendarLimit: FREE_CALENDAR_LIMIT, pro: false, syncLimit: 1 });

    await expect(runCreateSync(USER_ID, { ...oneWay("Titles", ["work"], ["personal"]), shareAs: "title_only" }, store.dependencies))
      .rejects.toBeInstanceOf(SyncContentNotAllowedError);
    await expect(runCreateSync(USER_ID, { ...oneWay("Skips", ["work"], ["personal"]), skipAllDay: true }, store.dependencies))
      .rejects.toBeInstanceOf(SyncContentNotAllowedError);

    await runCreateSync(USER_ID, { memberCalendarIds: ["work", "personal"], mode: "both_ways", name: "Block" }, store.dependencies);
    await expect(runCreateSync(USER_ID, { memberCalendarIds: ["school", "family"], mode: "both_ways", name: "Another" }, store.dependencies))
      .rejects.toBeInstanceOf(SyncLimitError);
  });

  it("counts only the user's own syncs against the sync limit", async () => {
    const store = createFakeStore({ syncLimit: 1 });
    await runCreateSync(OTHER_USER_ID, oneWay("Theirs", ["theirs"], ["theirs-too"]), {
      ...store.dependencies,
      withTransaction: (callback) => store.dependencies.withTransaction((transaction) => callback({
        ...transaction,
        findOwnedCalendars: (_userId, calendarIds) => Promise.resolve(calendarIds.map((id) => ({ capabilities: PULL_PUSH, id }))),
      })),
    });

    await expect(runCreateSync(USER_ID, oneWay("Mine", ["work"], ["personal"]), store.dependencies)).resolves.toBeTypeOf("string");
  });

  it("caps a free sync at three calendars on each side", async () => {
    const store = createFakeStore({ calendarLimit: FREE_CALENDAR_LIMIT, pro: false });

    await expect(runCreateSync(USER_ID, oneWay("Fan Out", ["work"], ["personal", "family", "school", "gym"]), store.dependencies))
      .rejects.toMatchObject({ message: "Free plans copy from up to 3 calendars into up to 3." });
    await expect(runCreateSync(USER_ID, {
      memberCalendarIds: ["work", "personal", "family", "school"],
      mode: "both_ways",
      name: "Mesh",
    }, store.dependencies)).rejects.toBeInstanceOf(SyncLimitError);
    await expect(runCreateSync(USER_ID, oneWay("Three", ["work", "gym", "travel"], ["personal", "family", "school"]), store.dependencies))
      .resolves.toBeTypeOf("string");
  });

  it("replaces client rule ids that are missing, reserved or repeated", async () => {
    const store = createFakeStore();
    const { id: _id, ...lunch } = rule(RULE_ID, " Lunch ");
    const syncId = await runCreateSync(USER_ID, {
      ...oneWay("Rules", ["work"], ["personal"]),
      rules: [{ ...lunch, id: RULE_ID }, { ...lunch, id: RULE_ID }, { ...lunch, id: "share" }, lunch],
    }, store.dependencies);

    const ids = store.definitionOf(syncId).rules.map((stored) => stored.id);
    expect(ids[0]).toBe(RULE_ID);
    expect(new Set(ids).size).toBe(4);
    expect(ids).not.toContain("share");
    expect(store.definitionOf(syncId).rules[0]).toMatchObject({ conditions: [{ kind: "title_contains", value: "Lunch" }], name: "Lunch" });
  });
});

describe("runUpdateSync", () => {
  const seed = async (options: FakeStoreOptions = {}) => {
    const store = createFakeStore(options);
    const syncId = await runCreateSync(USER_ID, oneWay("Work Blocks Personal", ["work"], ["personal"]), store.dependencies);
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

  it("refuses to take pairs another sync owns, naming it", async () => {
    const store = createFakeStore();
    await runCreateSync(USER_ID, oneWay("Kids", ["work"], ["family"]), store.dependencies);
    const syncId = await runCreateSync(USER_ID, oneWay("Me", ["school"], ["personal"]), store.dependencies);

    const updating = runUpdateSync(USER_ID, syncId, { sourceCalendarIds: ["school", "work"], destinationCalendarIds: ["personal", "family"] }, store.dependencies);

    await expect(updating).rejects.toBeInstanceOf(SyncConflictError);
    await expect(updating).rejects.toMatchObject({
      conflicts: [{ destinationCalendarId: "family", sourceCalendarId: "work", syncName: "Kids" }],
    });
    expect(store.definitionOf(syncId).sourceCalendarIds).toEqual(["school"]);
  });

  it("doesn't count its own pairs as conflicts", async () => {
    const { store, syncId } = await seed();
    await expect(runUpdateSync(USER_ID, syncId, { destinationCalendarIds: ["personal", "family"] }, store.dependencies))
      .resolves.toEqual([{ calendarId: "family", kind: "calendar_added", role: "destination" }]);
  });

  it("renames without touching pairs or asking for a sync run", async () => {
    const { store, syncId } = await seed();

    await runUpdateSync(USER_ID, syncId, { name: "Work Hours" }, store.dependencies);

    expect(store.definitionOf(syncId).name).toBe("Work Hours");
    expect(store.log).toEqual(["lock"]);
  });

  it("renames and pauses a sync a calendar deletion left empty", async () => {
    const { store, syncId } = await seed();
    store.setDefinition(syncId, { destinationCalendarIds: [] });

    await expect(runUpdateSync(USER_ID, syncId, { name: "Leftover" }, store.dependencies)).resolves.toHaveLength(1);
    await expect(runUpdateSync(USER_ID, syncId, { paused: true }, store.dependencies)).resolves.toEqual([{ kind: "paused" }]);
    expect(store.log).not.toContain("pairs");
    await expect(runUpdateSync(USER_ID, syncId, { sourceCalendarIds: ["work", "school"] }, store.dependencies))
      .rejects.toMatchObject({ message: "Pick calendars to copy from and to." });
  });

  it("pauses a sync whose calendar lost the capability its role needs", async () => {
    const calendars = { ...DEFAULT_CALENDARS };
    const { store, syncId } = await seed({ calendars });
    calendars.personal = mine(["pull"]);
    await expect(runUpdateSync(USER_ID, syncId, { paused: true }, store.dependencies)).resolves.toEqual([{ kind: "paused" }]);
  });

  it("lets a free plan keep and take away Pro settings, but not add or change them", async () => {
    const { store, syncId } = await seed({ pro: false });
    store.setDefinition(syncId, { shareAs: "title_only", skipAllDay: true, skipFocusTime: true });

    await expect(runUpdateSync(USER_ID, syncId, { paused: true }, store.dependencies)).resolves.toEqual([{ kind: "paused" }]);
    await expect(runUpdateSync(USER_ID, syncId, { skipAllDay: false }, store.dependencies)).resolves.toHaveLength(1);
    await expect(runUpdateSync(USER_ID, syncId, { shareAs: "full" }, store.dependencies))
      .rejects.toBeInstanceOf(SyncContentNotAllowedError);
    await expect(runUpdateSync(USER_ID, syncId, { skipOutOfOffice: true }, store.dependencies))
      .rejects.toBeInstanceOf(SyncContentNotAllowedError);
    await expect(runUpdateSync(USER_ID, syncId, { shareAs: "busy_only" }, store.dependencies)).resolves.toHaveLength(1);
    expect(store.definitionOf(syncId)).toMatchObject({ shareAs: "busy_only", skipAllDay: false, skipFocusTime: true });
  });

  it("lets a free plan remove one rule of several", async () => {
    const { store, syncId } = await seed({ pro: false });
    const kept = rule(RULE_ID, "Lunch");
    store.setDefinition(syncId, { rules: [kept, rule("7f1c2b4e-8a3d-4e5f-9a7b-1c2d3e4f5a6b", "Gym")] });

    await expect(runUpdateSync(USER_ID, syncId, { rules: [kept] }, store.dependencies)).resolves.toEqual([{ kind: "rules_changed" }]);
    await expect(runUpdateSync(USER_ID, syncId, { rules: [kept, rule("8f1c2b4e-8a3d-4e5f-9a7b-1c2d3e4f5a6b", "Dentist")] }, store.dependencies))
      .rejects.toBeInstanceOf(SyncContentNotAllowedError);
  });

  it("lets a free sync grow only up to three calendars a side", async () => {
    const { store, syncId } = await seed({ calendarLimit: FREE_CALENDAR_LIMIT, pro: false });

    await runUpdateSync(USER_ID, syncId, { destinationCalendarIds: ["personal", "family", "school"] }, store.dependencies);
    await expect(runUpdateSync(USER_ID, syncId, { destinationCalendarIds: ["personal", "family", "school", "gym"] }, store.dependencies))
      .rejects.toBeInstanceOf(SyncLimitError);
  });

  it("keeps a grandfathered free sync's calendars, lets it shrink, but never grow past its size", async () => {
    const { store, syncId } = await seed({ calendarLimit: FREE_CALENDAR_LIMIT, pro: false });
    store.setDefinition(syncId, { destinationCalendarIds: ["personal", "family", "school", "gym"] });

    await expect(runUpdateSync(USER_ID, syncId, { name: "Grandfathered" }, store.dependencies)).resolves.toHaveLength(1);
    await expect(runUpdateSync(USER_ID, syncId, { destinationCalendarIds: ["family", "school", "gym", "personal"] }, store.dependencies))
      .resolves.toEqual([]);
    await expect(runUpdateSync(USER_ID, syncId, { destinationCalendarIds: ["personal", "family", "school", "travel"] }, store.dependencies))
      .resolves.toHaveLength(2);
    await expect(runUpdateSync(USER_ID, syncId, { destinationCalendarIds: ["personal", "family", "school", "travel", "gym"] }, store.dependencies))
      .rejects.toBeInstanceOf(SyncLimitError);
    await expect(runUpdateSync(USER_ID, syncId, { destinationCalendarIds: ["personal", "family"] }, store.dependencies))
      .resolves.toHaveLength(2);
  });

  it("refuses a save made against an older version of the sync", async () => {
    const { store, syncId } = await seed();
    const opened = store.syncs.get(syncId)?.updatedAt ?? "";

    await runUpdateSync(USER_ID, syncId, { destinationCalendarIds: ["personal", "family"], expectedUpdatedAt: opened }, store.dependencies);
    const stale = runUpdateSync(USER_ID, syncId, { destinationCalendarIds: ["personal", "school"], expectedUpdatedAt: opened }, store.dependencies);

    await expect(stale).rejects.toBeInstanceOf(SyncStaleError);
    expect(store.definitionOf(syncId).destinationCalendarIds).toEqual(["personal", "family"]);
    expect(store.pairs.map((pair) => pair.destinationCalendarId)).toEqual(["personal", "family"]);
  });

  it("applies a save made against the current version", async () => {
    const { store, syncId } = await seed();
    const opened = store.syncs.get(syncId)?.updatedAt ?? "";
    await expect(runUpdateSync(USER_ID, syncId, { expectedUpdatedAt: opened, name: "Fresh" }, store.dependencies)).resolves.toHaveLength(1);
  });

  it("switches mode by replacing the calendars with members", async () => {
    const { store, syncId } = await seed();

    await runUpdateSync(USER_ID, syncId, { memberCalendarIds: ["work", "personal"], mode: "both_ways" }, store.dependencies);

    expect(store.definitionOf(syncId)).toMatchObject({ destinationCalendarIds: [], mode: "both_ways", sourceCalendarIds: [] });
    expect(store.pairs).toHaveLength(2);
  });

  it("reports a sync that doesn't exist or belongs to someone else", async () => {
    const { store, syncId } = await seed();
    await expect(runUpdateSync(USER_ID, "missing", { name: "x" }, store.dependencies)).rejects.toBeInstanceOf(SyncNotFoundError);
    await expect(runUpdateSync(OTHER_USER_ID, syncId, { name: "x" }, store.dependencies)).rejects.toBeInstanceOf(SyncNotFoundError);
    expect(store.definitionOf(syncId).name).toBe("Work Blocks Personal");
  });

  it("saves nothing when nothing changed", async () => {
    const { store, syncId } = await seed();
    await expect(runUpdateSync(USER_ID, syncId, { name: "Work Blocks Personal" }, store.dependencies)).resolves.toEqual([]);
    expect(store.activity).toEqual([]);
  });
});

const createFakeLocks = (destinationsBySync: Record<string, string[]>, owned: string[]) => {
  const locked: string[][] = [];
  const events: string[] = [];
  const locks: SyncLockDependencies = {
    deleteSync: (_userId, syncId) => {
      events.push(`delete:${syncId}`);
      return Promise.resolve(syncId in destinationsBySync);
    },
    findOwnedDestinationIds: (_userId, body) => Promise.resolve(
      [...body.destinationCalendarIds ?? [], ...body.memberCalendarIds ?? []].filter((id) => owned.includes(id)),
    ),
    findSyncDestinationIds: (_userId, syncId) => Promise.resolve(destinationsBySync[syncId] ?? []),
    scheduleSync: () => {
      events.push("schedule");
    },
    withLocks: async (_userId, resolve, callback) => {
      const destinationCalendarIds = await resolve();
      locked.push(destinationCalendarIds);
      events.push("locked");
      return { destinationCalendarIds, result: await callback() };
    },
  };
  return { events, locked, locks };
};

describe("sync write locks", () => {
  it("locks a new sync's destinations, but not its sources, before writing", async () => {
    const store = createFakeStore();
    const fake = createFakeLocks({}, ["personal", "family", "work"]);

    await runLockedCreateSync(USER_ID, oneWay("Fan Out", ["work"], ["personal", "family"]), store.dependencies, fake.locks);

    expect(fake.locked).toEqual([["personal", "family"]]);
    expect(fake.events).toEqual(["locked", "schedule"]);
  });

  it("queues nothing when a locked create fails", async () => {
    const store = createFakeStore();
    const fake = createFakeLocks({}, ["feed"]);

    await expect(runLockedCreateSync(USER_ID, oneWay("Into a feed", ["work"], ["feed"]), store.dependencies, fake.locks))
      .rejects.toBeInstanceOf(SyncValidationError);
    expect(fake.events).toEqual(["locked"]);
  });

  it("locks both the old and the new destinations on an update", async () => {
    const store = createFakeStore();
    const syncId = await runCreateSync(USER_ID, oneWay("Work Blocks Personal", ["work"], ["personal"]), store.dependencies);
    const fake = createFakeLocks({ [syncId]: ["personal"] }, ["family", "personal", "work"]);

    await runLockedUpdateSync(USER_ID, syncId, { destinationCalendarIds: ["family"] }, store.dependencies, fake.locks);
    await runLockedUpdateSync(USER_ID, syncId, { memberCalendarIds: ["work", "family"], mode: "both_ways" }, store.dependencies, fake.locks);

    expect(fake.locked).toEqual([["personal", "family"], ["personal", "work", "family"]]);
    expect(fake.events).toEqual(["locked", "schedule", "locked", "schedule"]);
  });

  it("skips the locks for a rename, which can't change any copy", async () => {
    const store = createFakeStore();
    const syncId = await runCreateSync(USER_ID, oneWay("Work Blocks Personal", ["work"], ["personal"]), store.dependencies);
    const fake = createFakeLocks({ [syncId]: ["personal"] }, []);
    const rename: PatchSyncBody = { expectedUpdatedAt: store.syncs.get(syncId)?.updatedAt ?? "", name: "Hours" };

    await runLockedUpdateSync(USER_ID, syncId, rename, store.dependencies, fake.locks);

    expect(fake.locked).toEqual([]);
    expect(fake.events).toEqual([]);
  });

  it("doesn't queue a sync when an update changed nothing", async () => {
    const store = createFakeStore();
    const syncId = await runCreateSync(USER_ID, oneWay("Work Blocks Personal", ["work"], ["personal"]), store.dependencies);
    const fake = createFakeLocks({ [syncId]: ["personal"] }, ["personal"]);

    await runLockedUpdateSync(USER_ID, syncId, { destinationCalendarIds: ["personal"] }, store.dependencies, fake.locks);

    expect(fake.events).toEqual(["locked"]);
  });

  it("locks a deleted sync's destinations and 404s one that isn't there", async () => {
    const fake = createFakeLocks({ "sync-1": ["personal", "family"] }, []);

    await runLockedDeleteSync(USER_ID, "sync-1", fake.locks);
    await expect(runLockedDeleteSync(USER_ID, "sync-9", fake.locks)).rejects.toBeInstanceOf(SyncNotFoundError);

    expect(fake.locked).toEqual([["personal", "family"], []]);
    expect(fake.events).toEqual(["locked", "delete:sync-1", "schedule", "locked", "delete:sync-9"]);
  });
});
