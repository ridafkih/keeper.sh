import { describe, expect, it } from "vitest";
import { getTableName } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import {
  applyCalendarRediscoveryPlan,
  markCalendarRediscoveryAttempt,
} from "../../../src/core/source/apply-calendar-rediscovery";
import type { DiscoveredCalendar } from "../../../src/core/source/calendar-rediscovery";
import { normalizeCalDAVServerHost } from "../../../src/providers/caldav/shared/calendar-identity";

interface CalendarRow {
  id: string;
  externalCalendarId: string | null;
  calendarUrl: string | null;
  unavailableSince: Date | null;
  createdAt: Date;
}

interface MappingRow {
  id: string;
  sourceCalendarId: string;
  destinationCalendarId: string;
}

interface RecordedUpdate {
  table: string;
  values: Record<string, unknown>;
}

interface RecordedInsert {
  table: string;
  rows: Record<string, unknown>[];
  returningKeys: string[];
}

interface FakeQuery {
  from: (table: unknown) => FakeQuery;
  innerJoin: (...args: unknown[]) => FakeQuery;
  leftJoin: (...args: unknown[]) => FakeQuery;
  limit: (value: number) => FakeQuery;
  orderBy: (...args: unknown[]) => FakeQuery;
  where: (condition?: unknown) => Promise<Record<string, unknown>[]>;
}

const NOW = new Date("2026-08-12T10:00:00.000Z");
const CREATED_AT = new Date("2026-01-01T00:00:00.000Z");
const MARKED_AT = new Date("2026-07-01T00:00:00.000Z");

const PLAN_KEYS = [
  "crossAccountSkippedCount",
  "duplicateCount",
  "suppressed",
  "toInsert",
  "toMarkUnavailable",
  "toRetargetUrl",
  "toRevive",
  "unchangedCount",
];

const toRecord = (value: unknown): Record<string, unknown> => value as Record<string, unknown>;

const tableNameOf = (table: unknown): string =>
  getTableName(table as Parameters<typeof getTableName>[0]);

const createFakeDatabase = (options: {
  calendars: CalendarRow[];
  mappings: MappingRow[];
  crossAccountCalendars?: { calendarUrl: string | null; serverUrl: string }[];
  insertedRows?: Record<string, unknown>[];
}) => {
  const operations: string[] = [];
  const executed: SQL[] = [];
  const readConditions: unknown[] = [];
  const inserts: RecordedInsert[] = [];
  const updates: RecordedUpdate[] = [];
  const touchedTables: string[] = [];
  let deleteAccessed = false;
  let readCount = 0;

  const resolveRead = (): Record<string, unknown>[] => {
    readCount += 1;
    if (readCount === 1) {
      return options.calendars.map((calendar) => toRecord(calendar));
    }
    return (options.crossAccountCalendars ?? []).map((row) => toRecord(row));
  };

  const createQuery = (): FakeQuery => {
    const query: FakeQuery = {
      from: (table: unknown) => {
        operations.push(`read:${tableNameOf(table)}`);
        return query;
      },
      innerJoin: () => query,
      leftJoin: () => query,
      limit: () => query,
      orderBy: () => query,
      where: (condition?: unknown) => {
        readConditions.push(condition);
        return Promise.resolve(resolveRead());
      },
    };
    return query;
  };

  const createUpdate = (table: unknown) => {
    const tableName = tableNameOf(table);
    return {
      set: (values: unknown) => {
        updates.push({ table: tableName, values: toRecord(values) });
        touchedTables.push(tableName);
        operations.push(`update:${tableName}`);
        return { where: () => Promise.resolve(null) };
      },
    };
  };

  const transaction = {
    execute: (query: SQL) => {
      executed.push(query);
      operations.push("execute");
      return Promise.resolve();
    },
    get delete() {
      deleteAccessed = true;
      throw new Error("Rediscovery must never delete a calendar row");
    },
    insert: (table: unknown) => {
      const tableName = tableNameOf(table);
      return {
        values: (rows: unknown) => {
          const recorded: RecordedInsert = {
            returningKeys: [],
            rows: [rows].flat().map((row) => toRecord(row)),
            table: tableName,
          };
          inserts.push(recorded);
          touchedTables.push(tableName);
          operations.push(`insert:${tableName}`);
          return {
            returning: (fields?: Record<string, unknown>) => {
              recorded.returningKeys = Object.keys(fields ?? {});
              return Promise.resolve(options.insertedRows ?? []);
            },
          };
        },
      };
    },
    select: (_fields?: unknown) => createQuery(),
    update: createUpdate,
  };

  let transactionCount = 0;

  return {
    database: {
      transaction: <TResult>(callback: (tx: typeof transaction) => Promise<TResult>) => {
        transactionCount += 1;
        return callback(transaction);
      },
      update: createUpdate,
    },
    executed,
    inserts,
    operations,
    readConditions,
    touchedTables,
    transactionCount: () => transactionCount,
    updates,
    wasDeleteAccessed: () => deleteAccessed,
  };
};

const renderQuery = (query: SQL): string => {
  const rendered = new PgDialect().sqlToQuery(query);
  return `${rendered.sql} ${JSON.stringify(rendered.params)}`;
};

const calendarUpdates = (updates: RecordedUpdate[]): RecordedUpdate[] =>
  updates.filter(({ table }) => table === "calendars");

const caldavDiscovery = (
  calendarUrl: string,
  name: string,
  writable = true,
): DiscoveredCalendar => ({
  calendarUrl,
  externalCalendarId: null,
  identityKey: new URL(calendarUrl).pathname.replace(/\/+$/u, ""),
  name,
  writable,
});

const oauthDiscovery = (
  externalCalendarId: string,
  name: string,
  writable = true,
): DiscoveredCalendar => ({
  calendarUrl: null,
  externalCalendarId,
  identityKey: externalCalendarId,
  name,
  writable,
});

const oauthRow = (
  id: string,
  externalCalendarId: string,
  unavailableSince: Date | null = null,
): CalendarRow => ({
  calendarUrl: null,
  createdAt: CREATED_AT,
  externalCalendarId,
  id,
  unavailableSince,
});

const apply = (
  fake: ReturnType<typeof createFakeDatabase>,
  input: {
    calendarType: "oauth" | "caldav";
    caldavServerHost?: string | null;
    discovered: DiscoveredCalendar[];
  },
) =>
  applyCalendarRediscoveryPlan(fake.database as never, {
    accountId: "account-1",
    caldavServerHost: input.caldavServerHost ?? null,
    calendarType: input.calendarType,
    discovered: input.discovered,
    now: NOW,
    userId: "user-1",
  });

describe("applyCalendarRediscoveryPlan", () => {
  it("takes the user account advisory lock before reading anything", async () => {
    const fake = createFakeDatabase({ calendars: [], mappings: [] });

    await apply(fake, { calendarType: "oauth", discovered: [] });

    expect(fake.operations[0]).toBe("execute");
    const lock = renderQuery(fake.executed[0] as SQL);
    expect(lock).toContain("pg_advisory_xact_lock");
    expect(lock).toContain("9002");
    expect(lock).toContain("user-1");
    expect(fake.operations.indexOf("execute"))
      .toBeLessThan(fake.operations.indexOf("read:calendars"));
  });

  it("reads the cross-account CalDAV keys inside the locked transaction", async () => {
    const fake = createFakeDatabase({
      calendars: [],
      crossAccountCalendars: [],
      mappings: [],
    });

    await apply(fake, {
      caldavServerHost: "cloud.example.com",
      calendarType: "caldav",
      discovered: [],
    });

    const reads = fake.operations.filter((operation) => operation === "read:calendars");
    expect(reads).toHaveLength(2);
    expect(fake.operations.indexOf("execute")).toBe(0);
  });

  it("issues no cross-account read for an OAuth account", async () => {
    const fake = createFakeDatabase({ calendars: [], mappings: [] });

    await apply(fake, { calendarType: "oauth", discovered: [] });

    const reads = fake.operations.filter((operation) => operation === "read:calendars");
    expect(reads).toHaveLength(1);
  });

  it.each([
    ["an internationalized domain", "https://münchen.example/remote.php/dav"],
    ["a bracketed IPv6 literal", "https://[2001:db8::1]:8443/remote.php/dav"],
    ["a mixed-case host with a port", "https://Cloud.Example.com:8443/remote.php/dav"],
    ["a host with userinfo", "https://bob:secret@cloud.example.com/remote.php/dav"],
  ])("blocks a same-server cross-account CalDAV calendar behind %s", async (_label, serverUrl) => {
    const fake = createFakeDatabase({
      calendars: [],
      crossAccountCalendars: [{ calendarUrl: "https://host.invalid/dav/bob/work", serverUrl }],
      mappings: [],
    });

    const result = await apply(fake, {
      caldavServerHost: normalizeCalDAVServerHost(serverUrl),
      calendarType: "caldav",
      discovered: [caldavDiscovery("https://host.invalid/dav/bob/work/", "Work")],
    });

    expect(result.crossAccountSkippedCount).toBe(1);
    expect(fake.inserts).toHaveLength(0);
  });

  it("never blocks a calendar path served by a genuinely different host", async () => {
    const fake = createFakeDatabase({
      calendars: [],
      crossAccountCalendars: [{
        calendarUrl: "https://other.example/remote.php/dav/calendars/bob/work",
        serverUrl: "https://other.example/remote.php/dav",
      }],
      mappings: [],
    });

    const result = await apply(fake, {
      caldavServerHost: normalizeCalDAVServerHost("https://cloud.example.com/remote.php/dav"),
      calendarType: "caldav",
      discovered: [
        caldavDiscovery("https://cloud.example.com/remote.php/dav/calendars/bob/work", "Work"),
      ],
    });

    expect(result.crossAccountSkippedCount).toBe(0);
    expect(fake.inserts.flatMap(({ rows }) => rows)).toHaveLength(1);
  });

  it("adds newly discovered calendars with provider-derived capabilities", async () => {
    const fake = createFakeDatabase({
      calendars: [],
      insertedRows: [
        { id: "calendar-new-1", name: "Writable" },
        { id: "calendar-new-2", name: "Read Only" },
      ],
      mappings: [],
    });

    const result = await apply(fake, {
      calendarType: "oauth",
      discovered: [
        oauthDiscovery("external-1", "Writable", true),
        oauthDiscovery("external-2", "Read Only", false),
      ],
    });

    const inserted = fake.inserts.flatMap(({ rows }) => rows);
    expect(inserted).toHaveLength(2);
    expect(inserted[0]?.capabilities).toEqual(["pull", "push"]);
    expect(inserted[1]?.capabilities).toEqual(["pull"]);
    for (const row of inserted) {
      expect(row.unavailableSince).toBeUndefined();
      expect(row.originalName).toBe(row.name);
      expect(row.accountId).toBe("account-1");
      expect(row.userId).toBe("user-1");
      expect(row.externalCalendarId).toBeDefined();
      expect(row.calendarUrl).toBeUndefined();
    }
    expect(result.inserted).toEqual([
      { id: "calendar-new-1", name: "Writable" },
      { id: "calendar-new-2", name: "Read Only" },
    ]);
  });

  it("returns the database generated ids from the insert rather than the plan", async () => {
    const fake = createFakeDatabase({
      calendars: [],
      insertedRows: [{ id: "16f6e1b0-0c4d-4b25-9a58-6ec3f1f5b111", name: "Work" }],
      mappings: [],
    });

    const result = await apply(fake, {
      calendarType: "oauth",
      discovered: [oauthDiscovery("external-1", "Work")],
    });

    expect(fake.inserts[0]?.returningKeys.toSorted()).toEqual(["id", "name"]);
    expect(result.inserted).toEqual([
      { id: "16f6e1b0-0c4d-4b25-9a58-6ec3f1f5b111", name: "Work" },
    ]);
    expect(JSON.stringify(result.toInsert)).not.toContain("16f6e1b0");
  });

  it("issues no insert statement and reports nothing inserted when there is nothing new", async () => {
    const fake = createFakeDatabase({
      calendars: [oauthRow("calendar-1", "external-1")],
      mappings: [],
    });

    const result = await apply(fake, {
      calendarType: "oauth",
      discovered: [oauthDiscovery("external-1", "Work")],
    });

    expect(fake.inserts).toEqual([]);
    expect(result.inserted).toEqual([]);
  });

  it("inserts CalDAV calendars against calendarUrl rather than an external id", async () => {
    const fake = createFakeDatabase({
      calendars: [],
      crossAccountCalendars: [],
      mappings: [],
    });

    await apply(fake, {
      caldavServerHost: "cloud.example.com",
      calendarType: "caldav",
      discovered: [{
        calendarUrl: "https://cloud.example.com/dav/bob/work/",
        externalCalendarId: null,
        identityKey: "/dav/bob/work",
        name: "Work",
        writable: true,
      }],
    });

    const [row] = fake.inserts.flatMap(({ rows }) => rows);
    expect(row?.calendarUrl).toBe("https://cloud.example.com/dav/bob/work/");
    expect(row?.externalCalendarId).toBeUndefined();
    expect(row?.calendarType).toBe("caldav");
  });

  it("never inserts a CalDAV calendar already connected under another account on the same server", async () => {
    const fake = createFakeDatabase({
      calendars: [],
      crossAccountCalendars: [{
        calendarUrl: "https://cloud.example.com/dav/bob/work",
        serverUrl: "https://cloud.example.com/dav",
      }],
      mappings: [],
    });

    const result = await apply(fake, {
      caldavServerHost: "cloud.example.com",
      calendarType: "caldav",
      discovered: [
        {
          calendarUrl: "https://cloud.example.com/dav/bob/work/",
          externalCalendarId: null,
          identityKey: "/dav/bob/work",
          name: "Work",
          writable: true,
        },
        {
          calendarUrl: "https://cloud.example.com/dav/bob/private/",
          externalCalendarId: null,
          identityKey: "/dav/bob/private",
          name: "Private",
          writable: true,
        },
      ],
    });

    expect(result.crossAccountSkippedCount).toBe(1);
    const inserted = fake.inserts.flatMap(({ rows }) => rows);
    expect(inserted.map((row) => row.calendarUrl))
      .toEqual(["https://cloud.example.com/dav/bob/private/"]);
  });

  it("marks a vanished calendar and preserves its row and its sync mappings", async () => {
    const mappings: MappingRow[] = [
      {
        destinationCalendarId: "calendar-destination",
        id: "mapping-1",
        sourceCalendarId: "calendar-vanished",
      },
    ];
    const fake = createFakeDatabase({
      calendars: [
        oauthRow("calendar-kept", "external-1"),
        oauthRow("calendar-vanished", "external-2"),
      ],
      mappings,
    });

    const result = await apply(fake, {
      calendarType: "oauth",
      discovered: [oauthDiscovery("external-1", "Kept")],
    });

    expect(result.toMarkUnavailable).toEqual(["calendar-vanished"]);
    expect(fake.wasDeleteAccessed()).toBe(false);
    expect(fake.inserts).toEqual([]);
    expect(fake.touchedTables).not.toContain("source_destination_mappings");
    expect(fake.touchedTables).not.toContain("event_states");
    expect(fake.touchedTables).not.toContain("event_mappings");
    expect(mappings).toEqual([{
      destinationCalendarId: "calendar-destination",
      id: "mapping-1",
      sourceCalendarId: "calendar-vanished",
    }]);

    const markUpdate = calendarUpdates(fake.updates)
      .find(({ values }) => values.unavailableSince instanceof Date);
    expect(markUpdate?.values).toEqual({ unavailableSince: NOW });
  });

  it("ignores the identity-less destination row an OAuth account carries", async () => {
    const fake = createFakeDatabase({
      calendars: [
        oauthRow("calendar-source", "external-1"),
        {
          calendarUrl: null,
          createdAt: CREATED_AT,
          externalCalendarId: null,
          id: "calendar-destination",
          unavailableSince: null,
        },
      ],
      mappings: [],
    });

    const result = await apply(fake, {
      calendarType: "oauth",
      discovered: [oauthDiscovery("external-1", "Work")],
    });

    expect(result.toMarkUnavailable).toEqual([]);
    expect(result.toInsert).toEqual([]);
    expect(result.unchangedCount).toBe(1);
    expect(calendarUpdates(fake.updates)).toEqual([]);
  });

  it("reinstates a reappearing calendar by clearing only its unavailability", async () => {
    const fake = createFakeDatabase({
      calendars: [oauthRow("calendar-1", "external-1", MARKED_AT)],
      mappings: [],
    });

    const result = await apply(fake, {
      calendarType: "oauth",
      discovered: [oauthDiscovery("external-1", "Back")],
    });

    expect(result.toRevive).toEqual(["calendar-1"]);
    expect(fake.inserts).toEqual([]);

    const reviveUpdate = calendarUpdates(fake.updates)
      .find(({ values }) => values.unavailableSince === null);
    expect(reviveUpdate?.values).toEqual({ unavailableSince: null });

    for (const forbidden of [
      "disabled",
      "failureCount",
      "lastFailureAt",
      "nextAttemptAt",
      "ingestFailureCount",
      "ingestLastFailureAt",
      "ingestNextAttemptAt",
      "name",
      "originalName",
      "capabilities",
    ]) {
      expect(Object.keys(reviveUpdate?.values ?? {})).not.toContain(forbidden);
    }
  });

  it("advances the account success cursor on a successful enumeration", async () => {
    const fake = createFakeDatabase({
      calendars: [oauthRow("calendar-1", "external-1")],
      mappings: [],
    });

    const result = await apply(fake, {
      calendarType: "oauth",
      discovered: [oauthDiscovery("external-1", "Kept")],
    });

    expect(result.suppressed).toBe(false);
    const accountUpdate = fake.updates.find(({ table }) => table === "calendar_accounts");
    expect(accountUpdate?.values).toEqual({ calendarsRefreshedAt: NOW });
  });

  it("writes nothing at all when a successful enumeration comes back empty", async () => {
    const fake = createFakeDatabase({
      calendars: [oauthRow("calendar-1", "external-1")],
      mappings: [],
    });

    const result = await apply(fake, { calendarType: "oauth", discovered: [] });

    expect(result.suppressed).toBe(true);
    expect(result.toMarkUnavailable).toEqual([]);
    expect(fake.inserts).toEqual([]);
    expect(fake.updates).toEqual([]);
    expect(fake.wasDeleteAccessed()).toBe(false);
  });

  it("never writes the scheduling attempt cursor", async () => {
    const fake = createFakeDatabase({
      calendars: [oauthRow("calendar-1", "external-1")],
      mappings: [],
    });

    await apply(fake, {
      calendarType: "oauth",
      discovered: [
        oauthDiscovery("external-1", "Kept"),
        oauthDiscovery("external-2", "New"),
      ],
    });

    for (const update of fake.updates) {
      expect(Object.keys(update.values)).not.toContain("calendarsRefreshAttemptedAt");
    }
  });

  it("returns the whole plan alongside the inserted rows", async () => {
    const fake = createFakeDatabase({
      calendars: [oauthRow("calendar-1", "external-1")],
      insertedRows: [{ id: "calendar-2", name: "New" }],
      mappings: [],
    });

    const result = await apply(fake, {
      calendarType: "oauth",
      discovered: [
        oauthDiscovery("external-1", "Kept"),
        oauthDiscovery("external-2", "New"),
      ],
    });

    expect(Object.keys(result).toSorted()).toEqual([...PLAN_KEYS, "inserted"].toSorted());
  });
});

describe("markCalendarRediscoveryAttempt", () => {
  it("stamps only the attempt cursor and opens no transaction", async () => {
    const fake = createFakeDatabase({ calendars: [], mappings: [] });

    await markCalendarRediscoveryAttempt(fake.database as never, "account-1", NOW);

    expect(fake.transactionCount()).toBe(0);
    expect(fake.updates).toEqual([{
      table: "calendar_accounts",
      values: { calendarsRefreshAttemptedAt: NOW },
    }]);
    expect(fake.inserts).toEqual([]);
    expect(fake.wasDeleteAccessed()).toBe(false);
  });
});
