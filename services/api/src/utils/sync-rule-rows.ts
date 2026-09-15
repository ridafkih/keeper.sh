import { syncRuleAssignmentsTable, syncRulesTable } from "@keeper.sh/database/schema";
import { DEFAULT_RULE } from "@keeper.sh/data-schemas";
import type { RuleAction, RuleCondition, SyncRule } from "@keeper.sh/data-schemas";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import type { database as databaseInstance } from "@/context";

const EMPTY_LIST_COUNT = 0;
const FIRST_RESULT_LIMIT = 1;
const FIRST_POSITION = 0;

type DatabaseClient = typeof databaseInstance;
type RuleRowClient = Pick<DatabaseClient, "delete" | "insert" | "select">;

interface RuleRow {
  actions: RuleAction[];
  conditions: RuleCondition[];
  createdAt: Date;
  id: string;
  isDefault: boolean;
  name: string;
  updatedAt: Date;
  userId: string;
}

interface CalendarPair {
  destinationCalendarId: string;
  sourceCalendarId: string;
}

const RULE_ROW_COLUMNS = {
  actions: syncRulesTable.actions,
  conditions: syncRulesTable.conditions,
  createdAt: syncRulesTable.createdAt,
  id: syncRulesTable.id,
  isDefault: syncRulesTable.isDefault,
  name: syncRulesTable.name,
  updatedAt: syncRulesTable.updatedAt,
  userId: syncRulesTable.userId,
};

const serializeRule = (row: RuleRow): SyncRule => ({
  actions: row.actions,
  conditions: row.conditions,
  createdAt: row.createdAt.toISOString(),
  id: row.id,
  isDefault: row.isDefault,
  name: row.name,
  updatedAt: row.updatedAt.toISOString(),
});

const findDefaultRuleRow = async (client: RuleRowClient, userId: string): Promise<RuleRow | null> => {
  const [rule] = await client
    .select(RULE_ROW_COLUMNS)
    .from(syncRulesTable)
    .where(and(eq(syncRulesTable.userId, userId), eq(syncRulesTable.isDefault, true)))
    .limit(FIRST_RESULT_LIMIT);

  return rule ?? null;
};

// The partial unique index makes the insert a no-op when a default already exists.
const ensureDefaultRuleRow = async (client: RuleRowClient, userId: string): Promise<RuleRow> => {
  const [inserted] = await client
    .insert(syncRulesTable)
    .values({
      actions: [...DEFAULT_RULE.actions],
      conditions: [...DEFAULT_RULE.conditions],
      isDefault: true,
      name: DEFAULT_RULE.name,
      userId,
    })
    .onConflictDoNothing({
      target: syncRulesTable.userId,
      where: eq(syncRulesTable.isDefault, sql`true`),
    })
    .returning(RULE_ROW_COLUMNS);

  if (inserted) {
    return inserted;
  }
  const existing = await findDefaultRuleRow(client, userId);
  if (!existing) {
    throw new Error("Failed to resolve default sync rule");
  }
  return existing;
};

const pairCondition = (pair: CalendarPair) =>
  and(
    eq(syncRuleAssignmentsTable.sourceCalendarId, pair.sourceCalendarId),
    eq(syncRuleAssignmentsTable.destinationCalendarId, pair.destinationCalendarId),
  );

const deleteAssignmentsForPairs = async (client: RuleRowClient, pairs: CalendarPair[]): Promise<void> => {
  if (pairs.length === EMPTY_LIST_COUNT) {
    return;
  }
  await client
    .delete(syncRuleAssignmentsTable)
    .where(or(...pairs.map((pair) => pairCondition(pair))));
};

const findPairsWithAssignments = async (
  client: RuleRowClient,
  pairs: CalendarPair[],
): Promise<Set<string>> => {
  if (pairs.length === EMPTY_LIST_COUNT) {
    return new Set();
  }
  const assigned = await client
    .select({
      destinationCalendarId: syncRuleAssignmentsTable.destinationCalendarId,
      sourceCalendarId: syncRuleAssignmentsTable.sourceCalendarId,
    })
    .from(syncRuleAssignmentsTable)
    .where(or(...pairs.map((pair) => pairCondition(pair))));

  return new Set(assigned.map((pair) => `${pair.sourceCalendarId}::${pair.destinationCalendarId}`));
};

// Only pairs with no rules yet receive the default, so a pair the user already configured keeps its list.
const assignDefaultRuleToPairs = async (
  client: RuleRowClient,
  ruleId: string,
  pairs: CalendarPair[],
): Promise<void> => {
  const alreadyAssigned = await findPairsWithAssignments(client, pairs);
  const unassigned = pairs.filter(
    (pair) => !alreadyAssigned.has(`${pair.sourceCalendarId}::${pair.destinationCalendarId}`),
  );
  if (unassigned.length === EMPTY_LIST_COUNT) {
    return;
  }
  await client
    .insert(syncRuleAssignmentsTable)
    .values(unassigned.map((pair) => ({ ...pair, position: FIRST_POSITION, ruleId })))
    .onConflictDoNothing();
};

const findOwnedRuleIds = async (
  client: RuleRowClient,
  userId: string,
  ruleIds: string[],
): Promise<string[]> => {
  if (ruleIds.length === EMPTY_LIST_COUNT) {
    return [];
  }
  const owned = await client
    .select({ id: syncRulesTable.id })
    .from(syncRulesTable)
    .where(and(eq(syncRulesTable.userId, userId), inArray(syncRulesTable.id, ruleIds)));

  return owned.map(({ id }) => id);
};

export {
  RULE_ROW_COLUMNS,
  assignDefaultRuleToPairs,
  deleteAssignmentsForPairs,
  ensureDefaultRuleRow,
  findDefaultRuleRow,
  findOwnedRuleIds,
  serializeRule,
};
export type { CalendarPair, RuleRow, RuleRowClient };
