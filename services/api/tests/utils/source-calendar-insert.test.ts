import { describe, expect, it } from "vitest";
import {
  createSourceCalendarInsertDependencies,
  insertSourceCalendars,
} from "../../src/utils/source-calendar-insert";

interface InsertedCalendar {
  id: string;
  includeInIcalFeed: boolean;
}

interface MembershipRow {
  feedId: string;
  calendarId: string;
}

interface SourceCalendarInsertDependencies {
  insertCalendars: (values: Record<string, unknown>[]) => Promise<InsertedCalendar[]>;
  ensureDefaultFeed: (userId: string) => Promise<{ id: string }>;
  insertFeedCalendars: (rows: MembershipRow[]) => Promise<void>;
}

const API_SOURCE_ROOT = `${import.meta.dirname}/../../src`;

const makeDependencies = (
  overrides: Partial<SourceCalendarInsertDependencies> = {},
): {
  dependencies: SourceCalendarInsertDependencies;
  inserted: Record<string, unknown>[][];
  memberships: MembershipRow[];
  ensureCalls: string[];
} => {
  const inserted: Record<string, unknown>[][] = [];
  const memberships: MembershipRow[] = [];
  const ensureCalls: string[] = [];
  return {
    inserted,
    memberships,
    ensureCalls,
    dependencies: {
      insertCalendars: (values) => {
        inserted.push(values);
        return Promise.resolve(values.map((value, index) => ({
          id: String(value.externalCalendarId ?? `calendar-${index}`),
          includeInIcalFeed: value.includeInIcalFeed !== false,
        })));
      },
      ensureDefaultFeed: (userId) => {
        ensureCalls.push(userId);
        return Promise.resolve({ id: "feed-default" });
      },
      insertFeedCalendars: (rows) => {
        memberships.push(...rows);
        return Promise.resolve();
      },
      ...overrides,
    },
  };
};

describe("insertSourceCalendars", () => {
  it("materializes the default feed and joins imported calendars for a brand-new user", async () => {
    const { dependencies, memberships, ensureCalls } = makeDependencies();

    await insertSourceCalendars(dependencies, "user-new", [
      { externalCalendarId: "calendar-a", name: "Work", userId: "user-new" },
      { externalCalendarId: "calendar-b", name: "Personal", userId: "user-new" },
    ]);

    expect(ensureCalls).toEqual(["user-new"]);
    expect(memberships).toEqual([
      { feedId: "feed-default", calendarId: "calendar-a" },
      { feedId: "feed-default", calendarId: "calendar-b" },
    ]);
  });

  it("applies the source sync defaults so imported calendars land in the feed", async () => {
    const { dependencies, inserted } = makeDependencies();

    await insertSourceCalendars(dependencies, "user-1", [
      { externalCalendarId: "calendar-a", name: "Work", userId: "user-1" },
    ]);

    expect(inserted[0]?.[0]).toMatchObject({
      includeInIcalFeed: true,
      excludeEventName: true,
      customEventName: "{{calendar_name}}",
    });
  });

  it("joins the default feed only, never a user-created feed", async () => {
    const { dependencies, memberships } = makeDependencies();

    await insertSourceCalendars(dependencies, "user-1", [
      { externalCalendarId: "calendar-a", name: "Work", userId: "user-1" },
    ]);

    for (const row of memberships) {
      expect(row.feedId).toBe("feed-default");
    }
  });

  it("skips calendars the caller explicitly kept out of the feed", async () => {
    const { dependencies, memberships } = makeDependencies();

    await insertSourceCalendars(dependencies, "user-1", [
      { externalCalendarId: "calendar-a", name: "Work", userId: "user-1" },
      {
        externalCalendarId: "calendar-hidden",
        name: "Hidden",
        userId: "user-1",
        includeInIcalFeed: false,
      },
    ]);

    expect(memberships).toEqual([{ feedId: "feed-default", calendarId: "calendar-a" }]);
  });

  it("writes nothing at all for an empty batch", async () => {
    const { dependencies, inserted, memberships, ensureCalls } = makeDependencies();

    const result = await insertSourceCalendars(dependencies, "user-1", []);

    expect(result).toEqual([]);
    expect(inserted).toEqual([]);
    expect(memberships).toEqual([]);
    expect(ensureCalls).toEqual([]);
  });

  it("exposes a client-bound dependency factory for the call sites", () => {
    expect(createSourceCalendarInsertDependencies).toBeTypeOf("function");
  });
});

describe("calendar insert call sites", () => {
  const readSource = (relativePath: string): Promise<string> =>
    Bun.file(`${API_SOURCE_ROOT}/${relativePath}`).text();

  it("routes every source-import calendar insert through the shared helper", async () => {
    const offenders: string[] = [];
    const glob = new Bun.Glob("**/*.ts");

    for await (const relativePath of glob.scan({ cwd: API_SOURCE_ROOT })) {
      if (
        relativePath === "utils/source-calendar-insert.ts"
        || relativePath === "utils/destinations.ts"
      ) {
        continue;
      }
      const content = await readSource(relativePath);
      if (content.includes("insert(calendarsTable)")) {
        offenders.push(relativePath);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("leaves destination calendar creation outside the feed auto-join", async () => {
    const destinations = await readSource("utils/destinations.ts");

    expect(destinations).not.toContain("insertSourceCalendars");
    expect(destinations).not.toContain("applySourceSyncDefaults");
    expect(destinations).not.toContain("icalFeedCalendarsTable");
  });

  it("makes the membership insert re-runnable", async () => {
    const helper = await readSource("utils/source-calendar-insert.ts");

    expect(helper).toContain("onConflictDoNothing");
  });
});
