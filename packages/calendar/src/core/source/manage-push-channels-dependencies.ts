import { and, arrayContains, eq, inArray } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import {
  calendarAccountsTable,
  calendarPushChannelsTable,
  calendarsTable,
} from "@keeper.sh/database/schema";
import type { Plan } from "@keeper.sh/data-schemas";
import { buildUnknownChannelKey } from "./push-keys";
import { generatePushSecret } from "./push-secret";
import { resolvePushRegistrar } from "./push-registry";
import { toPushChannelState } from "./push-channel";
import type { RegistrarContext, StoredPushChannel } from "./push-channel";
import type {
  ManagePushChannelsDependencies,
  RegistrarContextRequest,
} from "./manage-push-channels";

const PUSH_PROVIDERS = ["google", "outlook"];
const FIRST_ROW_LIMIT = 1;
const LIVE_CHANNEL_STATES = ["active", "degraded", "registering"];

interface NegativeCache {
  del: (key: string) => Promise<unknown>;
}

interface LockStore {
  release: (key: string) => Promise<void>;
  tryAcquire: (key: string, ttlSeconds: number) => Promise<boolean>;
}

interface ManagePushChannelsConfig {
  createRegistrarContext: (request: RegistrarContextRequest) => Promise<RegistrarContext>;
  database: Pick<BunSQLDatabase, "insert" | "select" | "update">;
  locks: LockStore;
  negativeCache: NegativeCache;
  observe: (fields: Record<string, unknown>) => void;
  onlyAccountId?: string;
  recordError: (error: unknown, slug: string) => void;
  resolvePlan: (userId: string) => Promise<Plan>;
  webhookPublicUrl: string | null;
}

type PushChannelRow = typeof calendarPushChannelsTable.$inferSelect;

const toStoredPushChannel = (row: PushChannelRow): StoredPushChannel => ({
  ...row,
  state: toPushChannelState(row.state),
});

/*
 * The sweep is the only thing that registers a channel, so the API runs it too rather than
 * leave a freshly connected account without push until the next tick. Both callers build
 * the same dependencies over the same tables; what differs is the context each service
 * holds and, for the API, the account the run is narrowed to.
 */
const createManagePushChannelsDependencies = (
  config: ManagePushChannelsConfig,
): ManagePushChannelsDependencies => {
  const { database } = config;

  const eligibleCalendarScope = () => {
    const shared = and(
      arrayContains(calendarsTable.capabilities, ["pull"]),
      eq(calendarsTable.disabled, false),
      inArray(calendarAccountsTable.provider, PUSH_PROVIDERS),
    );
    if (!config.onlyAccountId) {
      return shared;
    }
    return and(shared, eq(calendarAccountsTable.id, config.onlyAccountId));
  };

  return {
    createRegistrarContext: config.createRegistrarContext,
    deleteNegativeCacheKey: async (provider, providerChannelId) => {
      await config.negativeCache.del(buildUnknownChannelKey(provider, providerChannelId));
    },
    generateChannelId: () => crypto.randomUUID(),
    generateSecret: generatePushSecret,
    insertChannel: async (row) => {
      const [inserted] = await database
        .insert(calendarPushChannelsTable)
        .values(row)
        .returning();
      if (!inserted) {
        throw new Error("Push channel insert returned no row");
      }
      return toStoredPushChannel(inserted);
    },
    now: () => new Date(),
    observe: config.observe,
    readChannel: async (channelId) => {
      const [row] = await database
        .select()
        .from(calendarPushChannelsTable)
        .where(eq(calendarPushChannelsTable.id, channelId))
        .limit(FIRST_ROW_LIMIT);
      if (!row) {
        return null;
      }
      return toStoredPushChannel(row);
    },
    recordError: config.recordError,
    releaseLock: (key) => config.locks.release(key),
    resolvePlan: config.resolvePlan,
    resolveRegistrar: resolvePushRegistrar,
    selectChannels: async () => {
      const rows = await database
        .select()
        .from(calendarPushChannelsTable)
        .where(inArray(calendarPushChannelsTable.state, LIVE_CHANNEL_STATES));
      return rows.map((row) => toStoredPushChannel(row));
    },
    selectEligibleCalendars: () => database
      .select({
        accountId: calendarAccountsTable.id,
        calendarId: calendarsTable.id,
        capabilities: calendarsTable.capabilities,
        disabled: calendarsTable.disabled,
        externalCalendarId: calendarsTable.externalCalendarId,
        needsReauthentication: calendarAccountsTable.needsReauthentication,
        provider: calendarAccountsTable.provider,
        providerAccountId: calendarAccountsTable.accountId,
        userId: calendarsTable.userId,
      })
      .from(calendarsTable)
      .innerJoin(calendarAccountsTable, eq(calendarsTable.accountId, calendarAccountsTable.id))
      .where(eligibleCalendarScope()),
    tryAcquireLock: (key, ttlSeconds) => config.locks.tryAcquire(key, ttlSeconds),
    updateChannel: async (channelId, updates) => {
      await database
        .update(calendarPushChannelsTable)
        .set(updates)
        .where(eq(calendarPushChannelsTable.id, channelId));
    },
    webhookPublicUrl: config.webhookPublicUrl,
  };
};

export { createManagePushChannelsDependencies };
export type { ManagePushChannelsConfig };
