import type { CronOptions } from "cronbake";
import {
  buildUnknownChannelKey,
  generatePushSecret,
  resolvePushRegistrar,
  toPushChannelState,
  type StoredPushChannel,
} from "@keeper.sh/calendar";
import { withCronWideEvent } from "@/utils/with-wide-event";
import { widelog } from "@/utils/logging";
import {
  runManagePushChannels,
  type ManagePushChannelsDependencies,
} from "@/utils/manage-push-channels-core";
import { createRegistrarContext } from "@/utils/push-channel-registrar";

const toStoredPushChannel = (
  row: Omit<StoredPushChannel, "state"> & { state: string },
): StoredPushChannel => ({ ...row, state: toPushChannelState(row.state) });

const createDefaultDependencies = async (): Promise<ManagePushChannelsDependencies> => {
  const { database, premiumService, refreshLockStore } = await import("@/context");
  const {
    calendarAccountsTable,
    calendarPushChannelsTable,
    calendarsTable,
  } = await import("@keeper.sh/database/schema");
  const { and, arrayContains, eq, inArray } = await import("drizzle-orm");
  const { default: environment } = await import("@/env");

  return {
    createRegistrarContext,
    deleteNegativeCacheKey: async (provider, providerChannelId) => {
      const { refreshLockRedis } = await import("@/context");
      await refreshLockRedis.del(buildUnknownChannelKey(provider, providerChannelId));
    },
    generateChannelId: () => crypto.randomUUID(),
    generateSecret: generatePushSecret,
    insertChannel: async (row) => {
      const [inserted] = await database
        .insert(calendarPushChannelsTable)
        .values(row as typeof calendarPushChannelsTable.$inferInsert)
        .returning();
      if (!inserted) {
        throw new Error("Push channel insert returned no row");
      }
      return toStoredPushChannel(inserted);
    },
    now: () => new Date(),
    observe: (fields) => {
      widelog.setFields(fields);
    },
    readChannel: async (channelId) => {
      const [row] = await database
        .select()
        .from(calendarPushChannelsTable)
        .where(eq(calendarPushChannelsTable.id, channelId))
        .limit(1);
      if (!row) {
        return null;
      }
      return toStoredPushChannel(row);
    },
    recordError: (error, slug) => {
      widelog.errorFields(error, { retriable: true, slug });
    },
    releaseLock: (key) => refreshLockStore.release(key),
    resolvePlan: (userId) => premiumService.getUserPlan(userId),
    resolveRegistrar: resolvePushRegistrar,
    selectChannels: async () => {
      const rows = await database
        .select()
        .from(calendarPushChannelsTable)
        .where(inArray(calendarPushChannelsTable.state, [
          "active",
          "degraded",
          "registering",
        ]));
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
      .where(and(
        arrayContains(calendarsTable.capabilities, ["pull"]),
        eq(calendarsTable.disabled, false),
        inArray(calendarAccountsTable.provider, ["google", "outlook"]),
      )),
    tryAcquireLock: (key, ttlSeconds) => refreshLockStore.tryAcquire(key, ttlSeconds),
    updateChannel: async (channelId, updates) => {
      await database
        .update(calendarPushChannelsTable)
        .set(updates as Partial<typeof calendarPushChannelsTable.$inferInsert>)
        .where(eq(calendarPushChannelsTable.id, channelId));
    },
    webhookPublicUrl: environment.WEBHOOK_PUBLIC_URL ?? null,
  };
};

export default withCronWideEvent({
  async callback() {
    const dependencies = await createDefaultDependencies();
    await runManagePushChannels(dependencies);
  },
  cron: "@every_5_minutes",
  name: import.meta.file,
  overrunProtection: true,
}) satisfies CronOptions;
