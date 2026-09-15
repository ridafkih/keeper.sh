import {
  calendarsTable,
  sourceDestinationMappingsTable,
  syncRuleAssignmentsTable,
  syncRulesTable,
} from "@keeper.sh/database/schema";
import {
  DEFAULT_RULE,
  areRuleActionsEqual,
  areRuleConditionsEqual,
} from "@keeper.sh/data-schemas";
import type { RuleAction, RuleCondition, SyncRule } from "@keeper.sh/data-schemas";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { database as databaseInstance } from "@/context";
import { assertAllIdsOwned } from "./owned-ids";
import {
  RULE_ROW_COLUMNS,
  ensureDefaultRuleRow,
  findOwnedRuleIds,
  serializeRule,
} from "./sync-rule-rows";
import type { CalendarPair, RuleRow, RuleRowClient } from "./sync-rule-rows";
import {
  requestUserSync,
  scheduleMappingReplacementSync,
  withMappingMutationLocks,
} from "./source-destination-mappings";

const EMPTY_LIST_COUNT = 0;
const FIRST_RESULT_LIMIT = 1;
const NEXT_RULE_COUNT = 1;
const USER_RULE_LOCK_NAMESPACE = 9005;
const RULE_LIMIT_ERROR_MESSAGE = "Free plans include one rule. Upgrade to Keeper.sh Pro for unlimited rules.";
const RULE_CONTENT_ERROR_MESSAGE = "This setting requires a Pro plan.";
const RULE_NOT_FOUND_ERROR_MESSAGE = "Rule not found.";
const DEFAULT_RULE_DELETION_ERROR_MESSAGE = "The default rule cannot be deleted.";
const MAPPING_NOT_FOUND_ERROR_MESSAGE = "Mapping not found.";
const UNOWNED_RULES_ERROR_MESSAGE = "Some rules not found";

type DatabaseClient = typeof databaseInstance;
type DatabaseTransactionCallback = Parameters<DatabaseClient["transaction"]>[0];
type DatabaseTransactionClient = Parameters<DatabaseTransactionCallback>[0];
type RuleReadClient = Pick<DatabaseClient, "select" | "selectDistinct">;

class RuleLimitError extends Error {}
class RuleContentNotAllowedError extends Error {}
class RuleNotFoundError extends Error {}
class DefaultRuleDeletionError extends Error {}
class MappingNotFoundError extends Error {}

interface RuleContent {
  actions: RuleAction[];
  conditions: RuleCondition[];
}

interface RuleUpdates {
  actions?: RuleAction[];
  conditions?: RuleCondition[];
  name?: string;
}

interface SyncRuleListItem extends SyncRule {
  assignmentCount: number;
}

interface SyncRuleAssignment {
  destinationId: string;
  sourceId: string;
}

interface SyncRuleDetail extends SyncRule {
  assignments: SyncRuleAssignment[];
}

const isDefaultContent = (content: RuleContent): boolean =>
  areRuleConditionsEqual(content.conditions, DEFAULT_RULE.conditions)
  && areRuleActionsEqual(content.actions, DEFAULT_RULE.actions);

const isSameContent = (left: RuleContent, right: RuleContent): boolean =>
  areRuleConditionsEqual(left.conditions, right.conditions)
  && areRuleActionsEqual(left.actions, right.actions);

// Free plans keep the default projection; anything else on a rule's content needs Pro.
const assertRuleContentAllowed = async (
  canEditRuleContent: () => Promise<boolean>,
  current: RuleContent | null,
  next: RuleContent,
): Promise<void> => {
  if (current && isSameContent(current, next)) {
    return;
  }
  if (isDefaultContent(next)) {
    return;
  }
  if (!(await canEditRuleContent())) {
    throw new RuleContentNotAllowedError(RULE_CONTENT_ERROR_MESSAGE);
  }
};

interface CreateRuleInput extends RuleContent {
  name: string;
  userId: string;
}

interface CreateRuleTransaction {
  acquireUserLock: (userId: string) => Promise<void>;
  countUserRules: (userId: string) => Promise<number>;
  ensureDefaultRule: (userId: string) => Promise<unknown>;
  insertRule: (input: CreateRuleInput) => Promise<SyncRule>;
}

interface CreateRuleDependencies {
  canAddRule: (userId: string, currentCount: number) => Promise<boolean>;
  canEditRuleContent: (userId: string) => Promise<boolean>;
  withTransaction: <TResult>(
    callback: (transaction: CreateRuleTransaction) => Promise<TResult>,
  ) => Promise<TResult>;
}

const runCreateRule = async (
  input: CreateRuleInput,
  dependencies: CreateRuleDependencies,
): Promise<SyncRule> => {
  await assertRuleContentAllowed(
    () => dependencies.canEditRuleContent(input.userId),
    null,
    input,
  );

  return await dependencies.withTransaction(async (transaction) => {
    await transaction.acquireUserLock(input.userId);
    await transaction.ensureDefaultRule(input.userId);

    const currentCount = await transaction.countUserRules(input.userId);
    if (!(await dependencies.canAddRule(input.userId, currentCount + NEXT_RULE_COUNT))) {
      throw new RuleLimitError(RULE_LIMIT_ERROR_MESSAGE);
    }

    return await transaction.insertRule(input);
  });
};

// Only a content change re-syncs; a rename never touches the copies.
const persistRuleChange = (
  current: RuleContent,
  next: RuleContent,
  persist: () => Promise<SyncRule | null>,
  persistAndResync: () => Promise<SyncRule | null>,
): Promise<SyncRule | null> => {
  if (isSameContent(current, next)) {
    return persist();
  }
  return persistAndResync();
};

interface UpdateRuleInput {
  ruleId: string;
  updates: RuleUpdates;
  userId: string;
}

interface UpdateRuleDependencies {
  canEditRuleContent: (userId: string) => Promise<boolean>;
  findRule: (userId: string, ruleId: string) => Promise<SyncRule | null>;
  persistUpdates: (userId: string, ruleId: string, updates: RuleUpdates) => Promise<SyncRule | null>;
  resyncRuleDestinations: (
    userId: string,
    ruleId: string,
    mutate: () => Promise<SyncRule | null>,
  ) => Promise<SyncRule | null>;
}

const runUpdateRule = async (
  input: UpdateRuleInput,
  dependencies: UpdateRuleDependencies,
): Promise<SyncRule> => {
  const current = await dependencies.findRule(input.userId, input.ruleId);
  if (!current) {
    throw new RuleNotFoundError(RULE_NOT_FOUND_ERROR_MESSAGE);
  }

  const next: RuleContent = {
    actions: input.updates.actions ?? current.actions,
    conditions: input.updates.conditions ?? current.conditions,
  };
  await assertRuleContentAllowed(
    () => dependencies.canEditRuleContent(input.userId),
    current,
    next,
  );

  const persist = () => dependencies.persistUpdates(input.userId, input.ruleId, input.updates);
  const updated = await persistRuleChange(current, next, persist, () =>
    dependencies.resyncRuleDestinations(input.userId, input.ruleId, persist));

  if (!updated) {
    throw new RuleNotFoundError(RULE_NOT_FOUND_ERROR_MESSAGE);
  }
  return updated;
};

interface DeleteRuleDependencies {
  deleteRule: (userId: string, ruleId: string) => Promise<string | null>;
  findRule: (userId: string, ruleId: string) => Promise<SyncRule | null>;
  resyncRuleDestinations: (
    userId: string,
    ruleId: string,
    mutate: () => Promise<string | null>,
  ) => Promise<string | null>;
}

const runDeleteRule = async (
  input: { ruleId: string; userId: string },
  dependencies: DeleteRuleDependencies,
): Promise<void> => {
  const rule = await dependencies.findRule(input.userId, input.ruleId);
  if (!rule) {
    throw new RuleNotFoundError(RULE_NOT_FOUND_ERROR_MESSAGE);
  }
  if (rule.isDefault) {
    throw new DefaultRuleDeletionError(DEFAULT_RULE_DELETION_ERROR_MESSAGE);
  }

  const deletedId = await dependencies.resyncRuleDestinations(
    input.userId,
    input.ruleId,
    () => dependencies.deleteRule(input.userId, input.ruleId),
  );
  if (!deletedId) {
    throw new RuleNotFoundError(RULE_NOT_FOUND_ERROR_MESSAGE);
  }
};

interface SetRuleAssignmentsInput extends CalendarPair {
  ruleIds: string[];
  userId: string;
}

interface SetRuleAssignmentsTransaction {
  acquireUserLock: (userId: string) => Promise<void>;
  findOwnedRuleIds: (userId: string, ruleIds: string[]) => Promise<string[]>;
  pairExists: (userId: string, pair: CalendarPair) => Promise<boolean>;
  replaceAssignments: (pair: CalendarPair, ruleIds: string[]) => Promise<void>;
  requestUserSync?: (userId: string) => Promise<void>;
}

interface SetRuleAssignmentsDependencies {
  withTransaction: <TResult>(
    callback: (transaction: SetRuleAssignmentsTransaction) => Promise<TResult>,
  ) => Promise<TResult>;
}

const runSetRuleAssignments = async (
  input: SetRuleAssignmentsInput,
  dependencies: SetRuleAssignmentsDependencies,
): Promise<void> => {
  const uniqueRuleIds = [...new Set(input.ruleIds)];
  const pair: CalendarPair = {
    destinationCalendarId: input.destinationCalendarId,
    sourceCalendarId: input.sourceCalendarId,
  };

  await dependencies.withTransaction(async (transaction) => {
    await transaction.acquireUserLock(input.userId);

    if (!(await transaction.pairExists(input.userId, pair))) {
      throw new MappingNotFoundError(MAPPING_NOT_FOUND_ERROR_MESSAGE);
    }

    if (uniqueRuleIds.length > EMPTY_LIST_COUNT) {
      const ownedRuleIds = await transaction.findOwnedRuleIds(input.userId, uniqueRuleIds);
      assertAllIdsOwned(uniqueRuleIds, ownedRuleIds, UNOWNED_RULES_ERROR_MESSAGE);
    }

    await transaction.replaceAssignments(pair, uniqueRuleIds);
    await transaction.requestUserSync?.(input.userId);
  });
};

const listRules = async (client: RuleReadClient, userId: string): Promise<SyncRuleListItem[]> => {
  const rows = await client
    .select({
      ...RULE_ROW_COLUMNS,
      assignmentCount: sql<number>`count(${syncRuleAssignmentsTable.id})::int`,
    })
    .from(syncRulesTable)
    .leftJoin(syncRuleAssignmentsTable, eq(syncRuleAssignmentsTable.ruleId, syncRulesTable.id))
    .where(eq(syncRulesTable.userId, userId))
    .groupBy(syncRulesTable.id)
    .orderBy(desc(syncRulesTable.isDefault), asc(syncRulesTable.createdAt), asc(syncRulesTable.id));

  return rows.map((row) => ({ ...serializeRule(row), assignmentCount: row.assignmentCount }));
};

const findRuleRow = async (
  client: RuleReadClient,
  userId: string,
  ruleId: string,
): Promise<RuleRow | null> => {
  const [rule] = await client
    .select(RULE_ROW_COLUMNS)
    .from(syncRulesTable)
    .where(and(eq(syncRulesTable.id, ruleId), eq(syncRulesTable.userId, userId)))
    .limit(FIRST_RESULT_LIMIT);

  return rule ?? null;
};

const findRuleForUser = async (
  client: RuleReadClient,
  userId: string,
  ruleId: string,
): Promise<SyncRule | null> => {
  const rule = await findRuleRow(client, userId, ruleId);
  if (!rule) {
    return null;
  }
  return serializeRule(rule);
};

const findRuleDetail = async (
  client: RuleReadClient,
  userId: string,
  ruleId: string,
): Promise<SyncRuleDetail | null> => {
  const rule = await findRuleRow(client, userId, ruleId);
  if (!rule) {
    return null;
  }

  const assignments = await client
    .select({
      destinationId: syncRuleAssignmentsTable.destinationCalendarId,
      sourceId: syncRuleAssignmentsTable.sourceCalendarId,
    })
    .from(syncRuleAssignmentsTable)
    .where(eq(syncRuleAssignmentsTable.ruleId, ruleId))
    .orderBy(asc(syncRuleAssignmentsTable.sourceCalendarId), asc(syncRuleAssignmentsTable.destinationCalendarId));

  return { ...serializeRule(rule), assignments };
};

const countUserRules = async (client: RuleReadClient, userId: string): Promise<number> => {
  const [result] = await client
    .select({ value: sql<number>`count(*)` })
    .from(syncRulesTable)
    .where(eq(syncRulesTable.userId, userId));

  return Number(result?.value ?? EMPTY_LIST_COUNT);
};

const findDestinationsUsingRule = async (
  client: RuleReadClient,
  userId: string,
  ruleId: string,
): Promise<string[]> => {
  const rows = await client
    .selectDistinct({ destinationCalendarId: syncRuleAssignmentsTable.destinationCalendarId })
    .from(syncRuleAssignmentsTable)
    .innerJoin(syncRulesTable, eq(syncRuleAssignmentsTable.ruleId, syncRulesTable.id))
    .where(and(eq(syncRulesTable.id, ruleId), eq(syncRulesTable.userId, userId)));

  return rows.map(({ destinationCalendarId }) => destinationCalendarId);
};

const pairExistsForUser = async (
  client: RuleReadClient,
  userId: string,
  pair: CalendarPair,
): Promise<boolean> => {
  const [mapping] = await client
    .select({ id: sourceDestinationMappingsTable.id })
    .from(sourceDestinationMappingsTable)
    .innerJoin(
      calendarsTable,
      eq(sourceDestinationMappingsTable.sourceCalendarId, calendarsTable.id),
    )
    .where(
      and(
        eq(calendarsTable.userId, userId),
        eq(sourceDestinationMappingsTable.sourceCalendarId, pair.sourceCalendarId),
        eq(sourceDestinationMappingsTable.destinationCalendarId, pair.destinationCalendarId),
      ),
    )
    .limit(FIRST_RESULT_LIMIT);

  return Boolean(mapping);
};

const getRuleAssignments = async (
  client: RuleReadClient,
  userId: string,
  pair: CalendarPair,
): Promise<string[] | null> => {
  if (!(await pairExistsForUser(client, userId, pair))) {
    return null;
  }

  const assignments = await client
    .select({ ruleId: syncRuleAssignmentsTable.ruleId })
    .from(syncRuleAssignmentsTable)
    .where(
      and(
        eq(syncRuleAssignmentsTable.sourceCalendarId, pair.sourceCalendarId),
        eq(syncRuleAssignmentsTable.destinationCalendarId, pair.destinationCalendarId),
      ),
    )
    .orderBy(asc(syncRuleAssignmentsTable.position));

  return assignments.map(({ ruleId }) => ruleId);
};

const replaceRuleAssignments = async (
  client: RuleRowClient,
  pair: CalendarPair,
  ruleIds: string[],
): Promise<void> => {
  await client
    .delete(syncRuleAssignmentsTable)
    .where(
      and(
        eq(syncRuleAssignmentsTable.sourceCalendarId, pair.sourceCalendarId),
        eq(syncRuleAssignmentsTable.destinationCalendarId, pair.destinationCalendarId),
      ),
    );

  if (ruleIds.length === EMPTY_LIST_COUNT) {
    return;
  }

  await client
    .insert(syncRuleAssignmentsTable)
    .values(ruleIds.map((ruleId, position) => ({ ...pair, position, ruleId })))
    .onConflictDoNothing();
};

const acquireUserRuleLock = async (
  transactionClient: DatabaseTransactionClient,
  userId: string,
): Promise<void> => {
  await transactionClient.execute(
    sql`select pg_advisory_xact_lock(${USER_RULE_LOCK_NAMESPACE}, hashtext(${userId}))`,
  );
};

const insertRuleRow = async (
  client: RuleRowClient,
  input: CreateRuleInput,
): Promise<SyncRule> => {
  const [inserted] = await client
    .insert(syncRulesTable)
    .values({
      actions: input.actions,
      conditions: input.conditions,
      name: input.name,
      userId: input.userId,
    })
    .returning(RULE_ROW_COLUMNS);

  if (!inserted) {
    throw new Error("Failed to create sync rule");
  }
  return serializeRule(inserted);
};

const ensureDefaultRule = async (client: RuleRowClient, userId: string): Promise<SyncRule> =>
  serializeRule(await ensureDefaultRuleRow(client, userId));

// Destinations are collected before the mutation so a delete still re-syncs the copies it orphans.
const resyncRuleDestinations = async <TResult>(
  userId: string,
  ruleId: string,
  mutate: (transactionClient: DatabaseTransactionClient) => Promise<TResult>,
): Promise<TResult> => {
  const { database } = await import("@/context");
  const mutation = await withMappingMutationLocks(
    userId,
    () => findDestinationsUsingRule(database, userId, ruleId),
    () => database.transaction(async (transactionClient) => {
      const result = await mutate(transactionClient);
      await requestUserSync(transactionClient, userId);
      return result;
    }),
  );
  if (mutation.destinationCalendarIds.length > EMPTY_LIST_COUNT) {
    scheduleMappingReplacementSync(userId);
  }
  return mutation.result;
};

const createRule = async (
  userId: string,
  input: { name: string } & RuleContent,
): Promise<SyncRule> => {
  const { database, premiumService } = await import("@/context");

  return await runCreateRule(
    { ...input, userId },
    {
      canAddRule: (resolvedUserId, currentCount) =>
        premiumService.canAddRule(resolvedUserId, currentCount),
      canEditRuleContent: (resolvedUserId) => premiumService.canUseEventFilters(resolvedUserId),
      withTransaction: (callback) =>
        database.transaction((transactionClient) => callback({
          acquireUserLock: (resolvedUserId) => acquireUserRuleLock(transactionClient, resolvedUserId),
          countUserRules: (resolvedUserId) => countUserRules(transactionClient, resolvedUserId),
          ensureDefaultRule: (resolvedUserId) => ensureDefaultRuleRow(transactionClient, resolvedUserId),
          insertRule: (ruleInput) => insertRuleRow(transactionClient, ruleInput),
        })),
    },
  );
};

const persistRuleUpdates = async (
  client: Pick<DatabaseClient, "update">,
  userId: string,
  ruleId: string,
  updates: RuleUpdates,
): Promise<SyncRule | null> => {
  const [updated] = await client
    .update(syncRulesTable)
    .set(updates)
    .where(and(eq(syncRulesTable.id, ruleId), eq(syncRulesTable.userId, userId)))
    .returning(RULE_ROW_COLUMNS);

  if (!updated) {
    return null;
  }
  return serializeRule(updated);
};

const updateRule = async (
  userId: string,
  ruleId: string,
  updates: RuleUpdates,
): Promise<SyncRule> => {
  const { database, premiumService } = await import("@/context");

  return await runUpdateRule(
    { ruleId, updates, userId },
    {
      canEditRuleContent: (resolvedUserId) => premiumService.canUseEventFilters(resolvedUserId),
      findRule: (resolvedUserId, resolvedRuleId) =>
        findRuleForUser(database, resolvedUserId, resolvedRuleId),
      persistUpdates: (resolvedUserId, resolvedRuleId, resolvedUpdates) =>
        persistRuleUpdates(database, resolvedUserId, resolvedRuleId, resolvedUpdates),
      resyncRuleDestinations: (resolvedUserId, resolvedRuleId) =>
        resyncRuleDestinations(
          resolvedUserId,
          resolvedRuleId,
          (transactionClient) =>
            persistRuleUpdates(transactionClient, resolvedUserId, resolvedRuleId, updates),
        ),
    },
  );
};

const deleteRuleRow = async (
  client: Pick<DatabaseClient, "delete">,
  userId: string,
  ruleId: string,
): Promise<string | null> => {
  const [deleted] = await client
    .delete(syncRulesTable)
    .where(and(eq(syncRulesTable.id, ruleId), eq(syncRulesTable.userId, userId)))
    .returning({ id: syncRulesTable.id });

  return deleted?.id ?? null;
};

const deleteRule = async (userId: string, ruleId: string): Promise<void> => {
  const { database } = await import("@/context");

  await runDeleteRule(
    { ruleId, userId },
    {
      deleteRule: (resolvedUserId, resolvedRuleId) =>
        deleteRuleRow(database, resolvedUserId, resolvedRuleId),
      findRule: (resolvedUserId, resolvedRuleId) =>
        findRuleForUser(database, resolvedUserId, resolvedRuleId),
      resyncRuleDestinations: (resolvedUserId, resolvedRuleId) =>
        resyncRuleDestinations(
          resolvedUserId,
          resolvedRuleId,
          (transactionClient) => deleteRuleRow(transactionClient, resolvedUserId, resolvedRuleId),
        ),
    },
  );
};

const setRuleAssignments = async (
  userId: string,
  pair: CalendarPair,
  ruleIds: string[],
): Promise<void> => {
  const { database } = await import("@/context");

  await withMappingMutationLocks(
    userId,
    () => Promise.resolve([pair.destinationCalendarId]),
    () => runSetRuleAssignments(
      { ...pair, ruleIds, userId },
      {
        withTransaction: (callback) =>
          database.transaction((transactionClient) => callback({
            acquireUserLock: (resolvedUserId) => acquireUserRuleLock(transactionClient, resolvedUserId),
            findOwnedRuleIds: (resolvedUserId, candidateRuleIds) =>
              findOwnedRuleIds(transactionClient, resolvedUserId, candidateRuleIds),
            pairExists: (resolvedUserId, candidatePair) =>
              pairExistsForUser(transactionClient, resolvedUserId, candidatePair),
            replaceAssignments: (resolvedPair, resolvedRuleIds) =>
              replaceRuleAssignments(transactionClient, resolvedPair, resolvedRuleIds),
            requestUserSync: (resolvedUserId) => requestUserSync(transactionClient, resolvedUserId),
          })),
      },
    ),
  );
  scheduleMappingReplacementSync(userId);
};

export {
  DEFAULT_RULE_DELETION_ERROR_MESSAGE,
  DefaultRuleDeletionError,
  MAPPING_NOT_FOUND_ERROR_MESSAGE,
  MappingNotFoundError,
  RULE_CONTENT_ERROR_MESSAGE,
  RULE_LIMIT_ERROR_MESSAGE,
  RULE_NOT_FOUND_ERROR_MESSAGE,
  RuleContentNotAllowedError,
  RuleLimitError,
  RuleNotFoundError,
  UNOWNED_RULES_ERROR_MESSAGE,
  assertRuleContentAllowed,
  countUserRules,
  createRule,
  deleteRule,
  ensureDefaultRule,
  findDestinationsUsingRule,
  findRuleDetail,
  findRuleForUser,
  getRuleAssignments,
  listRules,
  replaceRuleAssignments,
  runCreateRule,
  runDeleteRule,
  runSetRuleAssignments,
  runUpdateRule,
  setRuleAssignments,
  updateRule,
};
export type {
  RuleContent,
  RuleUpdates,
  SyncRuleAssignment,
  SyncRuleDetail,
  SyncRuleListItem,
};
