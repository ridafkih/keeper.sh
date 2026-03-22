import {
  caldavCredentialsTable,
  calendarAccountsTable,
  calendarsTable,
} from "@keeper.sh/database/schema";
import {
  createSourceProvisioningDispatcher,
} from "@keeper.sh/machine-orchestration";
import {
  TransitionPolicy,
} from "@keeper.sh/state-machines";
import { and, eq, sql } from "drizzle-orm";
import { encryptPassword } from "@keeper.sh/database";
import { database, premiumService, encryptionKey } from "@/context";
import { enqueuePushSync } from "./enqueue-push-sync";
import { applySourceSyncDefaults } from "./source-sync-defaults";
import { resolveSyncEnqueuePlan } from "./sync-enqueue-plan";
import {
  CalDAVEncryptionKeyMissingError,
  CalDAVSourceAccountCreateError,
  CalDAVSourceCreateError,
  CalDAVSourceCredentialCreateError,
  CalDAVSourceLimitError,
  CalDAVSourceMissingCalendarUrlError,
  CalDAVSourceProvisioningInvariantError,
  DuplicateCalDAVSourceError,
} from "./caldav-source-errors";
import {
  findReusableCalDAVAccountWithDatabase,
  countUserAccountsWithDatabase as countUserCalDAVAccountsWithDatabase,
  getUserCalDAVSourcesWithDatabase,
  verifyCalDAVSourceOwnershipWithDatabase,
  type CaldavSourceDatabase,
  type CalDAVSource,
} from "./caldav-source-query-repository";

const FIRST_RESULT_LIMIT = 1;
const CALDAV_CALENDAR_TYPE = "caldav";
const USER_ACCOUNT_LOCK_NAMESPACE = 9002;

interface CreateCalDAVSourceData {
  calendarUrl: string;
  name: string;
  password: string;
  provider: string;
  serverUrl: string;
  username: string;
}

const createCalDAVAccount = async (
  databaseClient: CaldavSourceDatabase,
  userId: string,
  data: CreateCalDAVSourceData,
  resolvedEncryptionKey: string,
): Promise<string> => {
  const encryptedPassword = encryptPassword(data.password, resolvedEncryptionKey);

  const [credential] = await databaseClient
    .insert(caldavCredentialsTable)
    .values({
      encryptedPassword,
      serverUrl: data.serverUrl,
      username: data.username,
    })
    .returning({ id: caldavCredentialsTable.id });

  if (!credential) {
    throw new CalDAVSourceCredentialCreateError();
  }

  const [account] = await databaseClient
    .insert(calendarAccountsTable)
    .values({
      authType: "caldav",
      caldavCredentialId: credential.id,
      displayName: data.username,
      provider: data.provider,
      userId,
    })
    .returning({ id: calendarAccountsTable.id });

  if (!account) {
    throw new CalDAVSourceAccountCreateError();
  }

  return account.id;
};

const getUserCalDAVSources = async (userId: string, provider?: string): Promise<CalDAVSource[]> => {
  return getUserCalDAVSourcesWithDatabase(database, userId, provider);
};

const createCalDAVSource = async (
  userId: string,
  data: CreateCalDAVSourceData,
): Promise<CalDAVSource> => {
  const requestId = crypto.randomUUID();
  const provisioningDispatcher = createSourceProvisioningDispatcher({
    actorId: "api-caldav-sources",
    mode: "create_single",
    provider: "caldav",
    requestId,
    transitionPolicy: TransitionPolicy.REJECT,
    userId,
  });
  const dispatchProvisioningEvent = provisioningDispatcher.dispatch;

  if (!encryptionKey) {
    dispatchProvisioningEvent({
      reason: "invalid_source",
      type: "VALIDATION_FAILED",
    });
    throw new CalDAVEncryptionKeyMissingError();
  }

  const resolvedEncryptionKey = encryptionKey;

  const result = await database.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(${USER_ACCOUNT_LOCK_NAMESPACE}, hashtext(${userId}))`,
    );

    const [existingSource] = await tx
      .select({ id: calendarsTable.id })
      .from(calendarsTable)
      .where(
        and(
          eq(calendarsTable.userId, userId),
          eq(calendarsTable.calendarUrl, data.calendarUrl),
          eq(calendarsTable.calendarType, CALDAV_CALENDAR_TYPE),
        ),
      )
      .limit(FIRST_RESULT_LIMIT);

    if (existingSource) {
      dispatchProvisioningEvent({ type: "VALIDATION_PASSED" });
      dispatchProvisioningEvent({ type: "QUOTA_ALLOWED" });
      dispatchProvisioningEvent({ type: "DUPLICATE_DETECTED" });
      throw new DuplicateCalDAVSourceError();
    }

    dispatchProvisioningEvent({ type: "VALIDATION_PASSED" });
    const existingAccount = await findReusableCalDAVAccountWithDatabase(
      tx,
      userId,
      data.provider,
      data.serverUrl,
      data.username,
    );

    if (!existingAccount) {
      const existingAccountCount = await countUserCalDAVAccountsWithDatabase(tx, userId);
      const allowed = await premiumService.canAddAccount(userId, existingAccountCount);

      if (!allowed) {
        dispatchProvisioningEvent({ type: "QUOTA_DENIED" });
        throw new CalDAVSourceLimitError();
      }
    }
    dispatchProvisioningEvent({ type: "QUOTA_ALLOWED" });
    dispatchProvisioningEvent({ type: "DEDUPLICATION_PASSED" });

    const accountId = existingAccount?.id ??
      await createCalDAVAccount(tx, userId, data, resolvedEncryptionKey);
    if (existingAccount?.id) {
      dispatchProvisioningEvent({
        accountId: existingAccount.id,
        type: "ACCOUNT_REUSED",
      });
    } else {
      dispatchProvisioningEvent({
        accountId,
        type: "ACCOUNT_CREATED",
      });
    }

    const [source] = await tx
      .insert(calendarsTable)
      .values(applySourceSyncDefaults({
        accountId,
        calendarType: CALDAV_CALENDAR_TYPE,
        capabilities: ["pull", "push"],
        calendarUrl: data.calendarUrl,
        name: data.name,
        originalName: data.name,
        userId,
      }))
      .returning();

    if (!source) {
      throw new CalDAVSourceCreateError();
    }
    dispatchProvisioningEvent({
      sourceIds: [source.id],
      type: "SOURCE_CREATED",
    });
    const completionTransition = dispatchProvisioningEvent({
      mode: "create_single",
      sourceIds: [source.id],
      type: "BOOTSTRAP_SYNC_TRIGGERED",
    });
    const bootstrapRequested = completionTransition.outputs.some(
      (output) => output.type === "BOOTSTRAP_REQUESTED",
    );
    if (!bootstrapRequested) {
      throw new CalDAVSourceProvisioningInvariantError();
    }

    return {
      accountId,
      calendarUrl: data.calendarUrl,
      createdAt: source.createdAt,
      id: source.id,
      name: source.name,
      provider: data.provider,
      serverUrl: data.serverUrl,
      userId: source.userId,
      username: data.username,
    };
  });

  const plan = await resolveSyncEnqueuePlan(userId, (resolvedUserId) =>
    premiumService.getUserPlan(resolvedUserId),
  );
  await enqueuePushSync(userId, plan);

  return result;
};

const verifyCalDAVSourceOwnership = async (userId: string, calendarId: string): Promise<boolean> => {
  return verifyCalDAVSourceOwnershipWithDatabase(database, userId, calendarId);
};

export {
  CalDAVSourceLimitError,
  CalDAVSourceCredentialCreateError,
  CalDAVSourceAccountCreateError,
  CalDAVSourceMissingCalendarUrlError,
  CalDAVEncryptionKeyMissingError,
  CalDAVSourceCreateError,
  CalDAVSourceProvisioningInvariantError,
  DuplicateCalDAVSourceError,
  getUserCalDAVSources,
  createCalDAVSource,
  verifyCalDAVSourceOwnership,
};
