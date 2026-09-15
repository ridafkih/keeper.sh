import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_RULE } from "@keeper.sh/data-schemas";
import type { database as databaseInstance } from "../../src/context";
import {
  countUserRules,
  ensureDefaultRule,
  findDestinationsUsingRule,
  findRuleDetail,
  getRuleAssignments,
  listRules,
  replaceRuleAssignments,
} from "../../src/utils/sync-rules";
import {
  assignDefaultRuleToPairs,
  deleteAssignmentsForPairs,
  findOwnedRuleIds,
} from "../../src/utils/sync-rule-rows";

const DDL = `
create table calendars (
  "id" uuid primary key,
  "userId" text not null,
  "name" text not null
);
create table source_destination_mappings (
  "id" uuid primary key default gen_random_uuid(),
  "sourceCalendarId" uuid not null,
  "destinationCalendarId" uuid not null
);
create table sync_rules (
  "id" uuid primary key default gen_random_uuid(),
  "userId" text not null,
  "name" text not null,
  "conditions" jsonb not null default '[]'::jsonb,
  "actions" jsonb not null default '[]'::jsonb,
  "isDefault" boolean not null default false,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);
create unique index "sync_rules_user_default_idx" on sync_rules ("userId") where "isDefault" = true;
create table sync_rule_assignments (
  "id" uuid primary key default gen_random_uuid(),
  "sourceCalendarId" uuid not null references calendars("id") on delete cascade,
  "destinationCalendarId" uuid not null references calendars("id") on delete cascade,
  "ruleId" uuid not null references sync_rules("id") on delete cascade,
  "position" integer not null,
  "createdAt" timestamptz not null default now(),
  unique ("sourceCalendarId", "destinationCalendarId", "ruleId")
);
`;

const client = new PGlite();
const database = drizzle(client) as unknown as typeof databaseInstance;

const USER_ID = "user-rules";
const OTHER_USER_ID = "user-other";
const SOURCE_ID = "00000000-0000-4000-8000-0000000000a1";
const WORK_DESTINATION_ID = "00000000-0000-4000-8000-0000000000b1";
const HOME_DESTINATION_ID = "00000000-0000-4000-8000-0000000000b2";
const OTHER_SOURCE_ID = "00000000-0000-4000-8000-0000000000c1";
const WORK_PAIR = { destinationCalendarId: WORK_DESTINATION_ID, sourceCalendarId: SOURCE_ID };
const HOME_PAIR = { destinationCalendarId: HOME_DESTINATION_ID, sourceCalendarId: SOURCE_ID };

const insertRule = async (userId: string, name: string): Promise<string> => {
  const result = await client.query<{ id: string }>(
    `insert into sync_rules ("userId", "name", "conditions", "actions")
     values ($1, $2, '[{"kind":"all_day"}]'::jsonb, '[{"kind":"skip"}]'::jsonb) returning "id"`,
    [userId, name],
  );
  const [row] = result.rows;
  if (!row) {
    throw new Error("insert failed");
  }
  return row.id;
};

beforeAll(async () => {
  await client.exec(DDL);
  for (const [id, userId, name] of [
    [SOURCE_ID, USER_ID, "Source"],
    [WORK_DESTINATION_ID, USER_ID, "Work"],
    [HOME_DESTINATION_ID, USER_ID, "Home"],
    [OTHER_SOURCE_ID, OTHER_USER_ID, "Other"],
  ]) {
    await client.query(
      `insert into calendars ("id", "userId", "name") values ($1, $2, $3)`,
      [id, userId, name],
    );
  }
  for (const pair of [WORK_PAIR, HOME_PAIR]) {
    await client.query(
      `insert into source_destination_mappings ("sourceCalendarId", "destinationCalendarId") values ($1, $2)`,
      [pair.sourceCalendarId, pair.destinationCalendarId],
    );
  }
});

describe("sync rule queries", () => {
  it("creates the default rule once and reuses it afterwards", async () => {
    const first = await ensureDefaultRule(database, USER_ID);
    const second = await ensureDefaultRule(database, USER_ID);

    expect(first.id).toBe(second.id);
    expect(first.isDefault).toBe(true);
    expect(first.name).toBe(DEFAULT_RULE.name);
    expect(first.actions).toEqual(DEFAULT_RULE.actions);
    expect(await countUserRules(database, USER_ID)).toBe(1);
  });

  it("orders assignments by position and lists usage counts", async () => {
    const defaultRule = await ensureDefaultRule(database, USER_ID);
    const skipRuleId = await insertRule(USER_ID, "Skip all-day");

    await replaceRuleAssignments(database, WORK_PAIR, [skipRuleId, defaultRule.id]);
    await replaceRuleAssignments(database, HOME_PAIR, [defaultRule.id]);

    expect(await getRuleAssignments(database, USER_ID, WORK_PAIR)).toEqual([skipRuleId, defaultRule.id]);
    expect(await getRuleAssignments(database, USER_ID, HOME_PAIR)).toEqual([defaultRule.id]);

    const rules = await listRules(database, USER_ID);
    expect(rules.map((rule) => [rule.name, rule.assignmentCount])).toEqual([
      [DEFAULT_RULE.name, 2],
      ["Skip all-day", 1],
    ]);

    const detail = await findRuleDetail(database, USER_ID, skipRuleId);
    expect(detail?.assignments).toEqual([
      { destinationId: WORK_DESTINATION_ID, sourceId: SOURCE_ID },
    ]);
    expect(await findDestinationsUsingRule(database, USER_ID, defaultRule.id)).toEqual(
      expect.arrayContaining([WORK_DESTINATION_ID, HOME_DESTINATION_ID]),
    );
  });

  it("reports a missing pair as null and hides other users' pairs", async () => {
    expect(await getRuleAssignments(database, USER_ID, {
      destinationCalendarId: WORK_DESTINATION_ID,
      sourceCalendarId: OTHER_SOURCE_ID,
    })).toBeNull();
    expect(await getRuleAssignments(database, OTHER_USER_ID, WORK_PAIR)).toBeNull();
  });

  it("scopes ownership lookups to the user", async () => {
    const otherRuleId = await insertRule(OTHER_USER_ID, "Foreign");
    const defaultRule = await ensureDefaultRule(database, USER_ID);

    expect(await findOwnedRuleIds(database, USER_ID, [defaultRule.id, otherRuleId])).toEqual([
      defaultRule.id,
    ]);
    expect(await findRuleDetail(database, USER_ID, otherRuleId)).toBeNull();
  });

  it("assigns the default rule only to pairs without rules and prunes removed pairs", async () => {
    const defaultRule = await ensureDefaultRule(database, USER_ID);
    const skipRuleId = await insertRule(USER_ID, "Skip focus");
    await replaceRuleAssignments(database, WORK_PAIR, [skipRuleId]);
    await replaceRuleAssignments(database, HOME_PAIR, []);

    await assignDefaultRuleToPairs(database, defaultRule.id, [WORK_PAIR, HOME_PAIR]);

    expect(await getRuleAssignments(database, USER_ID, WORK_PAIR)).toEqual([skipRuleId]);
    expect(await getRuleAssignments(database, USER_ID, HOME_PAIR)).toEqual([defaultRule.id]);

    await deleteAssignmentsForPairs(database, [WORK_PAIR]);

    expect(await getRuleAssignments(database, USER_ID, WORK_PAIR)).toEqual([]);
    expect(await getRuleAssignments(database, USER_ID, HOME_PAIR)).toEqual([defaultRule.id]);
  });

  it("cascades assignments when a rule is deleted", async () => {
    const ruleId = await insertRule(USER_ID, "Temporary");
    await replaceRuleAssignments(database, HOME_PAIR, [ruleId]);

    await client.query(`delete from sync_rules where "id" = $1`, [ruleId]);

    expect(await getRuleAssignments(database, USER_ID, HOME_PAIR)).toEqual([]);
  });
});
