import { describe, expect, it } from "vitest";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { resolveWriteBackPolicies } from "../src/sync-user";

const DESTINATION_CALENDAR_ID = "destination-calendar-id";
const SOURCE_CALENDAR_ID = "source-calendar-id";

type Row = Record<string, unknown>;

const createSelectChain = (rows: Row[]): Record<string, unknown> => {
  const chain: Record<string, unknown> = {
    from: () => chain,
    innerJoin: () => chain,
    leftJoin: () => chain,
    where: () => Promise.resolve(rows),
  };
  return chain;
};

const createResolvedWrite = (rows: Row[]) =>
  Object.assign(Promise.resolve(rows), { returning: () => Promise.resolve(rows) });

/*
 * The fake applies what a statement sets, so a restore issued before the policies are
 * read is visible to that read exactly as it would be against a real database.
 */
const createDatabase = (rows: Row[], updates: Row[]): BunSQLDatabase => ({
  select: () => createSelectChain(rows),
  update: () => ({
    set: (values: Row) => {
      updates.push(values);
      for (const row of rows) {
        Object.assign(row, values);
      }
      return { where: () => createResolvedWrite(rows) };
    },
  }),
}) as unknown as BunSQLDatabase;

const createRow = (overrides: Row = {}): Row => ({
  calendarType: "google",
  capabilities: ["pull", "push"],
  excludeEventDescription: false,
  excludeEventLocation: false,
  excludeEventName: false,
  ingestLastSucceededAt: new Date(),
  sourceCalendarId: SOURCE_CALENDAR_ID,
  writeBackMode: "edits",
  writeBackReach: "own_events",
  writeBackState: "ok",
  writeBackStateReason: null,
  ...overrides,
});

describe("a pair paused only because the plan lapsed writes again once it is back", () => {
  /*
   * Nothing else in the product ever moves a quarantined pair back to ok, and the
   * dashboard renders the stored mode as selected, so a pair left quarantined here is a
   * subscriber whose two-way sync is silently dead with the UI claiming otherwise.
   */
  it("restores the pair when the account carries the plan again", async () => {
    const updates: Row[] = [];
    const rows = [createRow({
      writeBackState: "quarantined",
      writeBackStateReason: "plan_downgraded",
    })];

    const policies = await resolveWriteBackPolicies(
      createDatabase(rows, updates),
      DESTINATION_CALENDAR_ID,
      "pro",
    );

    expect(policies.get(SOURCE_CALENDAR_ID)).toMatchObject({
      paused: false,
      writeBackMode: "edits",
    });
    expect(updates[0]).toEqual({ writeBackState: "ok", writeBackStateReason: null });
  });

  /*
   * A quarantine the user has to look at is not the plan's to lift. Reading every pause
   * as a lapsed subscription would resume writing to a real calendar the pass had already
   * decided it could not trust.
   */
  it("leaves a pair quarantined for a safety reason exactly where it is", async () => {
    const updates: Row[] = [];
    const rows = [createRow({
      writeBackState: "quarantined",
      writeBackStateReason: "runaway_write_back",
    })];

    const policies = await resolveWriteBackPolicies(
      createDatabase(rows, updates),
      DESTINATION_CALENDAR_ID,
      "pro",
    );

    expect(policies.get(SOURCE_CALENDAR_ID)).toMatchObject({ writeBackMode: "off" });
    expect(updates).toEqual([]);
  });
});
