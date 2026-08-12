import {
  calendarsTable,
  icalFeedCalendarsTable,
  icalFeedsTable,
} from "@keeper.sh/database/schema";
import { user as userTable } from "@keeper.sh/database";
import { DEFAULT_FEED_NAME, DEFAULT_FEED_SETTINGS } from "@keeper.sh/data-schemas";
import { and, arrayContains, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { database as databaseInstance } from "@/context";
import { generateFeedToken } from "./ical-feed-tokens";
import { assertAllIdsOwned } from "./owned-ids";

const EMPTY_LIST_COUNT = 0;
const FIRST_RESULT_LIMIT = 1;
const USER_FEED_LOCK_NAMESPACE = 9004;
const FEED_LIMIT_ERROR_MESSAGE =
  "Feed limit reached. Upgrade to Keeper.sh Pro for unlimited iCal feeds.";
const FEED_NOT_FOUND_ERROR_MESSAGE = "Feed not found.";
const DEFAULT_FEED_DELETION_ERROR_MESSAGE = "The default feed cannot be deleted.";
const UNOWNED_CALENDARS_ERROR_MESSAGE = "Some calendars not found";

type DatabaseClient = typeof databaseInstance;
type DatabaseTransactionCallback = Parameters<DatabaseClient["transaction"]>[0];
type DatabaseTransactionClient = Parameters<DatabaseTransactionCallback>[0];
type FeedWriteClient = Pick<DatabaseClient, "insert" | "select">;
type FeedMembershipClient = Pick<DatabaseClient, "delete" | "insert" | "select">;

class FeedLimitError extends Error {}
class FeedNotFoundError extends Error {}
class DefaultFeedDeletionError extends Error {}

interface Feed {
  id: string;
  userId: string;
  name: string;
  token: string;
  isDefault: boolean;
  legacyAlias: boolean;
}

const FEED_ROW_COLUMNS = {
  id: icalFeedsTable.id,
  userId: icalFeedsTable.userId,
  name: icalFeedsTable.name,
  token: icalFeedsTable.token,
  isDefault: icalFeedsTable.isDefault,
  legacyAlias: icalFeedsTable.legacyAlias,
  includeEventName: icalFeedsTable.includeEventName,
  includeEventDescription: icalFeedsTable.includeEventDescription,
  includeEventLocation: icalFeedsTable.includeEventLocation,
  excludeAllDayEvents: icalFeedsTable.excludeAllDayEvents,
  excludeFocusTime: icalFeedsTable.excludeFocusTime,
  excludeOutOfOffice: icalFeedsTable.excludeOutOfOffice,
  customEventName: icalFeedsTable.customEventName,
  createdAt: icalFeedsTable.createdAt,
};

interface EnsureDefaultFeedDependencies<TFeed> {
  insertDefaultFeed: (values: Record<string, unknown>) => Promise<TFeed | null>;
  findDefaultFeed: (userId: string) => Promise<TFeed | null>;
  generateToken: () => string;
}

const ensureDefaultFeed = async <TFeed>(
  dependencies: EnsureDefaultFeedDependencies<TFeed>,
  userId: string,
): Promise<TFeed> => {
  const inserted = await dependencies.insertDefaultFeed({
    userId,
    name: DEFAULT_FEED_NAME,
    token: dependencies.generateToken(),
    isDefault: true,
    ...DEFAULT_FEED_SETTINGS,
  });

  if (inserted) {
    return inserted;
  }

  const existing = await dependencies.findDefaultFeed(userId);
  if (!existing) {
    throw new Error("Failed to resolve default iCal feed");
  }
  return existing;
};

interface CreateFeedTransaction<TFeed> {
  acquireUserLock: (userId: string) => Promise<void>;
  ensureDefaultFeed: (userId: string) => Promise<TFeed>;
  countUserFeeds: (userId: string) => Promise<number>;
  insertFeed: (values: Record<string, unknown>) => Promise<TFeed>;
}

interface CreateFeedDependencies<TFeed> {
  resolveFeedLimit: (userId: string) => Promise<number>;
  generateToken: () => string;
  withTransaction: <TResult>(
    callback: (transaction: CreateFeedTransaction<TFeed>) => Promise<TResult>,
  ) => Promise<TResult>;
}

const runCreateFeed = async <TFeed>(
  input: { userId: string; name: string },
  dependencies: CreateFeedDependencies<TFeed>,
): Promise<TFeed> => {
  const limit = await dependencies.resolveFeedLimit(input.userId);

  return await dependencies.withTransaction(async (transaction) => {
    await transaction.acquireUserLock(input.userId);
    await transaction.ensureDefaultFeed(input.userId);

    const currentCount = await transaction.countUserFeeds(input.userId);
    if (currentCount + 1 > limit) {
      throw new FeedLimitError(FEED_LIMIT_ERROR_MESSAGE);
    }

    return await transaction.insertFeed({
      userId: input.userId,
      name: input.name,
      token: dependencies.generateToken(),
      isDefault: false,
    });
  });
};

interface SetFeedCalendarsTransaction {
  feedExists: (userId: string, feedId: string) => Promise<boolean>;
  findOwnedPullCalendarIds: (userId: string, calendarIds: string[]) => Promise<string[]>;
  replaceFeedCalendars: (feedId: string, calendarIds: string[]) => Promise<void>;
  syncDefaultFeedInclusion?: (
    userId: string,
    feedId: string,
    calendarIds: string[],
  ) => Promise<void>;
}

interface SetFeedCalendarsDependencies {
  withTransaction: <TResult>(
    callback: (transaction: SetFeedCalendarsTransaction) => Promise<TResult>,
  ) => Promise<TResult>;
}

const runSetFeedCalendars = async (
  input: { userId: string; feedId: string; calendarIds: string[] },
  dependencies: SetFeedCalendarsDependencies,
): Promise<void> => {
  const uniqueCalendarIds = [...new Set(input.calendarIds)];

  await dependencies.withTransaction(async (transaction) => {
    const feedExists = await transaction.feedExists(input.userId, input.feedId);
    if (!feedExists) {
      throw new FeedNotFoundError(FEED_NOT_FOUND_ERROR_MESSAGE);
    }

    if (uniqueCalendarIds.length > EMPTY_LIST_COUNT) {
      const ownedCalendarIds = await transaction.findOwnedPullCalendarIds(
        input.userId,
        uniqueCalendarIds,
      );
      assertAllIdsOwned(uniqueCalendarIds, ownedCalendarIds, UNOWNED_CALENDARS_ERROR_MESSAGE);
    }

    await transaction.replaceFeedCalendars(input.feedId, uniqueCalendarIds);
    await transaction.syncDefaultFeedInclusion?.(
      input.userId,
      input.feedId,
      uniqueCalendarIds,
    );
  });
};

interface DeleteFeedDependencies<TFeed extends { isDefault: boolean }> {
  findFeed: (userId: string, feedId: string) => Promise<TFeed | null>;
  deleteFeed: (userId: string, feedId: string) => Promise<string | null>;
}

const runDeleteFeed = async <TFeed extends { isDefault: boolean }>(
  input: { userId: string; feedId: string },
  dependencies: DeleteFeedDependencies<TFeed>,
): Promise<void> => {
  const feed = await dependencies.findFeed(input.userId, input.feedId);

  if (!feed) {
    throw new FeedNotFoundError(FEED_NOT_FOUND_ERROR_MESSAGE);
  }

  if (feed.isDefault) {
    throw new DefaultFeedDeletionError(DEFAULT_FEED_DELETION_ERROR_MESSAGE);
  }

  const deletedId = await dependencies.deleteFeed(input.userId, input.feedId);
  if (!deletedId) {
    throw new FeedNotFoundError(FEED_NOT_FOUND_ERROR_MESSAGE);
  }
};

const buildFeedListQuery = (client: Pick<DatabaseClient, "select">, userId: string) =>
  client
    .select({
      ...FEED_ROW_COLUMNS,
      calendarCount: sql<number>`count(${icalFeedCalendarsTable.calendarId})`,
    })
    .from(icalFeedsTable)
    .leftJoin(icalFeedCalendarsTable, eq(icalFeedCalendarsTable.feedId, icalFeedsTable.id))
    .where(eq(icalFeedsTable.userId, userId))
    .groupBy(icalFeedsTable.id)
    .orderBy(
      desc(icalFeedsTable.isDefault),
      asc(icalFeedsTable.createdAt),
      asc(icalFeedsTable.id),
    );

const insertDefaultFeedRow = async (
  client: FeedWriteClient,
  values: Record<string, unknown>,
): Promise<Feed | null> => {
  const [inserted] = await client
    .insert(icalFeedsTable)
    .values(values as typeof icalFeedsTable.$inferInsert)
    .onConflictDoNothing({
      target: icalFeedsTable.userId,
      where: eq(icalFeedsTable.isDefault, sql`true`),
    })
    .returning(FEED_ROW_COLUMNS);

  return inserted ?? null;
};

const findDefaultFeedRow = async (
  client: FeedWriteClient,
  userId: string,
): Promise<Feed | null> => {
  const [feed] = await client
    .select(FEED_ROW_COLUMNS)
    .from(icalFeedsTable)
    .where(and(eq(icalFeedsTable.userId, userId), eq(icalFeedsTable.isDefault, true)))
    .limit(FIRST_RESULT_LIMIT);

  return feed ?? null;
};

const ensureDefaultFeedForClient = (client: FeedWriteClient, userId: string): Promise<Feed> =>
  ensureDefaultFeed(
    {
      insertDefaultFeed: (values) => insertDefaultFeedRow(client, values),
      findDefaultFeed: (resolvedUserId) => findDefaultFeedRow(client, resolvedUserId),
      generateToken: generateFeedToken,
    },
    userId,
  );

const createFeedTransaction = (
  transactionClient: DatabaseTransactionClient,
): CreateFeedTransaction<Feed> => ({
  acquireUserLock: async (userId) => {
    await transactionClient.execute(
      sql`select pg_advisory_xact_lock(${USER_FEED_LOCK_NAMESPACE}, hashtext(${userId}))`,
    );
  },
  ensureDefaultFeed: (userId) => ensureDefaultFeedForClient(transactionClient, userId),
  countUserFeeds: async (userId) => {
    const [result] = await transactionClient
      .select({ value: sql<number>`count(*)` })
      .from(icalFeedsTable)
      .where(eq(icalFeedsTable.userId, userId));

    return Number(result?.value ?? EMPTY_LIST_COUNT);
  },
  insertFeed: async (values) => {
    const [inserted] = await transactionClient
      .insert(icalFeedsTable)
      .values(values as typeof icalFeedsTable.$inferInsert)
      .returning(FEED_ROW_COLUMNS);

    if (!inserted) {
      throw new Error("Failed to create iCal feed");
    }
    return inserted;
  },
});

const createSetFeedCalendarsTransaction = (
  transactionClient: DatabaseTransactionClient,
): SetFeedCalendarsTransaction => ({
  feedExists: async (userId, feedId) => {
    const [feed] = await transactionClient
      .select({ id: icalFeedsTable.id })
      .from(icalFeedsTable)
      .where(and(eq(icalFeedsTable.id, feedId), eq(icalFeedsTable.userId, userId)))
      .limit(FIRST_RESULT_LIMIT);

    return Boolean(feed);
  },
  findOwnedPullCalendarIds: async (userId, calendarIds) => {
    if (calendarIds.length === EMPTY_LIST_COUNT) {
      return [];
    }

    const owned = await transactionClient
      .select({ id: calendarsTable.id })
      .from(calendarsTable)
      .where(
        and(
          eq(calendarsTable.userId, userId),
          inArray(calendarsTable.id, calendarIds),
          arrayContains(calendarsTable.capabilities, ["pull"]),
        ),
      );

    return owned.map(({ id }) => id);
  },
  replaceFeedCalendars: async (feedId, calendarIds) => {
    await transactionClient
      .delete(icalFeedCalendarsTable)
      .where(eq(icalFeedCalendarsTable.feedId, feedId));

    if (calendarIds.length === EMPTY_LIST_COUNT) {
      return;
    }

    await transactionClient
      .insert(icalFeedCalendarsTable)
      .values(calendarIds.map((calendarId) => ({ feedId, calendarId })))
      .onConflictDoNothing();
  },
  syncDefaultFeedInclusion: async (userId, feedId, calendarIds) => {
    const [feed] = await transactionClient
      .select({ isDefault: icalFeedsTable.isDefault })
      .from(icalFeedsTable)
      .where(eq(icalFeedsTable.id, feedId))
      .limit(FIRST_RESULT_LIMIT);

    if (!feed?.isDefault) {
      return;
    }

    await transactionClient
      .update(calendarsTable)
      .set({ includeInIcalFeed: false })
      .where(eq(calendarsTable.userId, userId));

    if (calendarIds.length === EMPTY_LIST_COUNT) {
      return;
    }

    await transactionClient
      .update(calendarsTable)
      .set({ includeInIcalFeed: true })
      .where(and(eq(calendarsTable.userId, userId), inArray(calendarsTable.id, calendarIds)));
  },
});

const createCreateFeedDependencies = async (): Promise<CreateFeedDependencies<Feed>> => {
  const { database, premiumService } = await import("@/context");

  return {
    resolveFeedLimit: async (userId) => {
      const userPlan = await premiumService.getUserPlan(userId);
      return premiumService.getFeedLimit(userPlan);
    },
    generateToken: generateFeedToken,
    withTransaction: (callback) =>
      database.transaction((transactionClient) =>
        callback(createFeedTransaction(transactionClient))),
  };
};

const createSetFeedCalendarsDependencies = async (): Promise<SetFeedCalendarsDependencies> => {
  const { database } = await import("@/context");

  return {
    withTransaction: (callback) =>
      database.transaction((transactionClient) =>
        callback(createSetFeedCalendarsTransaction(transactionClient))),
  };
};

const createFeed = async (userId: string, name: string): Promise<Feed> => {
  const dependencies = await createCreateFeedDependencies();
  return await runCreateFeed({ userId, name }, dependencies);
};

const setFeedCalendars = async (
  userId: string,
  feedId: string,
  calendarIds: string[],
): Promise<void> => {
  const dependencies = await createSetFeedCalendarsDependencies();
  await runSetFeedCalendars({ userId, feedId, calendarIds }, dependencies);
};

const findFeedForUser = async (
  client: Pick<DatabaseClient, "select">,
  userId: string,
  feedId: string,
): Promise<Feed | null> => {
  const [feed] = await client
    .select(FEED_ROW_COLUMNS)
    .from(icalFeedsTable)
    .where(and(eq(icalFeedsTable.id, feedId), eq(icalFeedsTable.userId, userId)))
    .limit(FIRST_RESULT_LIMIT);

  return feed ?? null;
};

const deleteFeed = async (userId: string, feedId: string): Promise<void> => {
  const { database } = await import("@/context");

  await runDeleteFeed(
    { userId, feedId },
    {
      findFeed: (resolvedUserId, resolvedFeedId) =>
        findFeedForUser(database, resolvedUserId, resolvedFeedId),
      deleteFeed: async (resolvedUserId, resolvedFeedId) => {
        const [deleted] = await database
          .delete(icalFeedsTable)
          .where(
            and(
              eq(icalFeedsTable.id, resolvedFeedId),
              eq(icalFeedsTable.userId, resolvedUserId),
            ),
          )
          .returning({ id: icalFeedsTable.id });

        return deleted?.id ?? null;
      },
    },
  );
};

const syncDefaultFeedMembership = async (
  client: FeedMembershipClient,
  userId: string,
  calendarId: string,
  included: boolean,
): Promise<void> => {
  const feed = await ensureDefaultFeedForClient(client, userId);

  if (!included) {
    await client
      .delete(icalFeedCalendarsTable)
      .where(
        and(
          eq(icalFeedCalendarsTable.feedId, feed.id),
          eq(icalFeedCalendarsTable.calendarId, calendarId),
        ),
      );
    return;
  }

  await client
    .insert(icalFeedCalendarsTable)
    .values({ feedId: feed.id, calendarId })
    .onConflictDoNothing();
};

const resolveLegacyFeedIdentifier = async (
  client: Pick<DatabaseClient, "select">,
  userId: string,
): Promise<string> => {
  const [owner] = await client
    .select({ username: userTable.username })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(FIRST_RESULT_LIMIT);

  if (!owner) {
    throw new Error("Failed to resolve the legacy iCal feed identifier");
  }

  return owner.username ?? userId;
};

const getFeedCalendarIds = async (
  userId: string,
  feedId: string,
): Promise<string[] | null> => {
  const { database } = await import("@/context");

  const feed = await findFeedForUser(database, userId, feedId);
  if (!feed) {
    return null;
  }

  const rows = await database
    .select({ id: icalFeedCalendarsTable.calendarId })
    .from(icalFeedCalendarsTable)
    .where(eq(icalFeedCalendarsTable.feedId, feedId));

  return rows.map(({ id }) => id);
};

export {
  DEFAULT_FEED_DELETION_ERROR_MESSAGE,
  DefaultFeedDeletionError,
  FEED_LIMIT_ERROR_MESSAGE,
  FEED_NOT_FOUND_ERROR_MESSAGE,
  FEED_ROW_COLUMNS,
  FeedLimitError,
  FeedNotFoundError,
  UNOWNED_CALENDARS_ERROR_MESSAGE,
  USER_FEED_LOCK_NAMESPACE,
  buildFeedListQuery,
  createFeed,
  deleteFeed,
  ensureDefaultFeed,
  ensureDefaultFeedForClient,
  findFeedForUser,
  getFeedCalendarIds,
  resolveLegacyFeedIdentifier,
  runCreateFeed,
  runDeleteFeed,
  runSetFeedCalendars,
  setFeedCalendars,
  syncDefaultFeedMembership,
};
export type { Feed, FeedMembershipClient };
