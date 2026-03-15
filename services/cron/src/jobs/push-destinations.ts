import type { CronOptions } from "cronbake";
import type { Plan } from "@keeper.sh/data-schemas";
import {
  getEventsForDestination,
  getEventMappingsForDestination,
  syncCalendar,
  createRedisGenerationCheck,
  createDatabaseFlush,
} from "@keeper.sh/calendar";
import type { CalendarSyncProvider, PendingChanges } from "@keeper.sh/calendar";
import { createGoogleSyncProvider } from "@keeper.sh/calendar/google";
import { createOutlookSyncProvider } from "@keeper.sh/calendar/outlook";
import { createCalDAVSyncProvider } from "@keeper.sh/calendar/caldav";
import { decryptPassword } from "@keeper.sh/database";
import {
  calendarAccountsTable,
  calendarsTable,
  caldavCredentialsTable,
  oauthCredentialsTable,
} from "@keeper.sh/database/schema";
import { and, arrayContains, eq } from "drizzle-orm";
import Redis from "ioredis";
import { setCronEventFields, withCronWideEvent } from "@/utils/with-wide-event";
import { widelog } from "@/utils/logging";
import { database } from "@/context";
import { getUsersWithDestinationsByPlan } from "@/utils/get-sources";
import env from "@/env";

const USER_TIMEOUT_MS = 300_000;
const REDIS_COMMAND_TIMEOUT_MS = 10_000;
const REDIS_MAX_RETRIES = 3;

const OAUTH_PROVIDERS = new Set(["google", "outlook"]);
const CALDAV_PROVIDERS = new Set(["caldav", "fastmail", "icloud"]);

const withTimeout = <TResult>(
  operation: () => Promise<TResult>,
  timeoutMs: number,
  label: string,
): Promise<TResult> =>
  Promise.race([
    Promise.resolve().then(operation),
    Bun.sleep(timeoutMs).then((): never => {
      throw new Error(`${label} timed out after ${timeoutMs}ms`);
    }),
  ]);

const resolveOAuthProvider = async (
  provider: string,
  calendarId: string,
  userId: string,
  accountId: string,
): Promise<CalendarSyncProvider | null> => {
  const [oauthCred] = await database
    .select({
      accessToken: oauthCredentialsTable.accessToken,
      refreshToken: oauthCredentialsTable.refreshToken,
      expiresAt: oauthCredentialsTable.expiresAt,
    })
    .from(oauthCredentialsTable)
    .innerJoin(calendarAccountsTable, eq(calendarAccountsTable.oauthCredentialId, oauthCredentialsTable.id))
    .where(eq(calendarAccountsTable.id, accountId))
    .limit(1);

  if (!oauthCred) {
    return null;
  }

  if (provider === "google" && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    return createGoogleSyncProvider({
      accessToken: oauthCred.accessToken,
      refreshToken: oauthCred.refreshToken,
      accessTokenExpiresAt: oauthCred.expiresAt,
      externalCalendarId: "primary",
      calendarId,
      userId,
    });
  }

  if (provider === "outlook" && env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET) {
    return createOutlookSyncProvider({
      accessToken: oauthCred.accessToken,
      refreshToken: oauthCred.refreshToken,
      accessTokenExpiresAt: oauthCred.expiresAt,
      calendarId,
      userId,
    });
  }

  return null;
};

const resolveCalDAVProvider = async (
  calendarId: string,
  encryptionKey: string,
): Promise<CalendarSyncProvider | null> => {
  const [caldavCred] = await database
    .select({
      username: caldavCredentialsTable.username,
      encryptedPassword: caldavCredentialsTable.encryptedPassword,
      serverUrl: caldavCredentialsTable.serverUrl,
      calendarUrl: calendarsTable.calendarUrl,
    })
    .from(caldavCredentialsTable)
    .innerJoin(calendarAccountsTable, eq(calendarAccountsTable.caldavCredentialId, caldavCredentialsTable.id))
    .innerJoin(calendarsTable, eq(calendarsTable.accountId, calendarAccountsTable.id))
    .where(eq(calendarsTable.id, calendarId))
    .limit(1);

  if (!caldavCred) {
    return null;
  }

  const password = decryptPassword(caldavCred.encryptedPassword, encryptionKey);

  return createCalDAVSyncProvider({
    calendarUrl: caldavCred.calendarUrl ?? caldavCred.serverUrl,
    serverUrl: caldavCred.serverUrl,
    username: caldavCred.username,
    password,
  });
};

const syncDestinationsForUser = async (
  userId: string,
  redis: Redis,
  flush: (changes: PendingChanges) => Promise<void>,
): Promise<{ added: number; addFailed: number; removed: number; removeFailed: number }> => {
  const destinations = await database
    .select({
      calendarId: calendarsTable.id,
      provider: calendarAccountsTable.provider,
      userId: calendarsTable.userId,
      accountId: calendarsTable.accountId,
    })
    .from(calendarsTable)
    .innerJoin(calendarAccountsTable, eq(calendarsTable.accountId, calendarAccountsTable.id))
    .where(
      and(
        eq(calendarsTable.userId, userId),
        arrayContains(calendarsTable.capabilities, ["push"]),
      ),
    );

  let added = 0;
  let addFailed = 0;
  let removed = 0;
  let removeFailed = 0;

  for (const destination of destinations) {
    let syncProvider: CalendarSyncProvider | null = null;

    if (OAUTH_PROVIDERS.has(destination.provider)) {
      syncProvider = await resolveOAuthProvider(
        destination.provider, destination.calendarId,
        destination.userId, destination.accountId,
      );
    }

    if (CALDAV_PROVIDERS.has(destination.provider) && env.ENCRYPTION_KEY) {
      syncProvider = await resolveCalDAVProvider(
        destination.calendarId, env.ENCRYPTION_KEY,
      );
    }

    if (!syncProvider) {
      continue;
    }

    const providerRef = syncProvider;
    const isCurrent = await createRedisGenerationCheck(redis, destination.calendarId);

    const result = await syncCalendar({
      calendarId: destination.calendarId,
      provider: providerRef,
      readState: async () => ({
        localEvents: await getEventsForDestination(database, destination.calendarId),
        existingMappings: await getEventMappingsForDestination(database, destination.calendarId),
        remoteEvents: await providerRef.listRemoteEvents(),
      }),
      isCurrent,
      flush,
      onSyncEvent: (event) => {
        widelog.setFields({
          ...event,
          "destination.provider": destination.provider,
          "user.id": destination.userId,
        });
      },
    });

    added += result.added;
    addFailed += result.addFailed;
    removed += result.removed;
    removeFailed += result.removeFailed;
  }

  return { added, addFailed, removed, removeFailed };
};

const runEgressJob = async (plan: Plan): Promise<void> => {
  const usersWithDestinations = await getUsersWithDestinationsByPlan(plan);

  setCronEventFields({
    "subscription.plan": plan,
    "user.count": usersWithDestinations.length,
  });

  if (usersWithDestinations.length === 0) {
    return;
  }

  const redis = new Redis(env.REDIS_URL, {
    commandTimeout: REDIS_COMMAND_TIMEOUT_MS,
    maxRetriesPerRequest: REDIS_MAX_RETRIES,
  });

  const flush = createDatabaseFlush(database);

  try {
    let totalAdded = 0;
    let totalAddFailed = 0;
    let totalRemoved = 0;
    let totalRemoveFailed = 0;
    let usersFailed = 0;

    const settlements = await Promise.allSettled(
      usersWithDestinations.map((userId) =>
        withTimeout(
          async () => {
            const result = await syncDestinationsForUser(userId, redis, flush);
            totalAdded += result.added;
            totalAddFailed += result.addFailed;
            totalRemoved += result.removed;
            totalRemoveFailed += result.removeFailed;
          },
          USER_TIMEOUT_MS,
          `push:user:${userId}`,
        ),
      ),
    );

    for (const settlement of settlements) {
      if (settlement.status === "rejected") {
        usersFailed += 1;
        widelog.errorFields(settlement.reason, { prefix: "push.user" });
      }
    }

    setCronEventFields({
      "events.added": totalAdded,
      "events.add_failed": totalAddFailed,
      "events.removed": totalRemoved,
      "events.remove_failed": totalRemoveFailed,
      "user.failed": usersFailed,
    });
  } finally {
    redis.disconnect();
  }
};

const createPushJob = (plan: Plan, cron: string): CronOptions =>
  withCronWideEvent({
    async callback() {
      setCronEventFields({ "job.type": "push-destinations", "subscription.plan": plan });
      await runEgressJob(plan);
    },
    cron,
    immediate: process.env.ENV !== "production",
    name: `push-destinations-${plan}`,
    overrunProtection: false,
  });

export default [
  createPushJob("free", "@every_30_minutes"),
  createPushJob("pro", "@every_1_minutes"),
];
