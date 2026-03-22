import {
  calendarAccountsTable,
  oauthCredentialsTable,
} from "@keeper.sh/database/schema";
import { eq } from "drizzle-orm";
import { OAuthCredentialCreateError } from "./destination-errors";
import {
  findExistingDestinationAccountWithDatabase,
  findMappedDestinationCalendarForAccountIdWithDatabase,
  initializeDestinationSyncStatusWithDatabase,
  setupNewDestinationWithDatabase,
  upsertAccountAndCalendarWithDatabase,
  validateDestinationAccountOwnership,
  type DestinationDatabase,
} from "./destination-account-repository";

const saveCalendarDestinationWithDatabase = async (
  databaseClient: DestinationDatabase,
  userId: string,
  provider: string,
  accountId: string,
  email: string | null,
  accessToken: string,
  refreshToken: string,
  expiresAt: Date,
  needsReauthentication = false,
): Promise<void> => {
  const existingAccount = await findExistingDestinationAccountWithDatabase(
    databaseClient,
    provider,
    accountId,
  );
  validateDestinationAccountOwnership(existingAccount, userId);

  if (existingAccount?.oauthCredentialId) {
    await databaseClient
      .update(oauthCredentialsTable)
      .set({ accessToken, expiresAt, refreshToken })
      .where(eq(oauthCredentialsTable.id, existingAccount.oauthCredentialId));

    await databaseClient
      .update(calendarAccountsTable)
      .set({ email, needsReauthentication })
      .where(eq(calendarAccountsTable.id, existingAccount.id));

    const existingCalendar = await findMappedDestinationCalendarForAccountIdWithDatabase(
      databaseClient,
      existingAccount.id,
    );
    if (existingCalendar) {
      await initializeDestinationSyncStatusWithDatabase(databaseClient, existingCalendar.id);
    }
    return;
  }

  const [credential] = await databaseClient
    .insert(oauthCredentialsTable)
    .values({ accessToken, email, expiresAt, provider, refreshToken, userId })
    .returning({ id: oauthCredentialsTable.id });

  if (!credential) {
    throw new OAuthCredentialCreateError();
  }

  const calendarId = await upsertAccountAndCalendarWithDatabase(databaseClient, {
    accountId,
    email,
    needsReauthentication,
    oauthCredentialId: credential.id,
    provider,
    userId,
  });

  if (calendarId) {
    await setupNewDestinationWithDatabase(databaseClient, calendarId);
  }
};

export {
  saveCalendarDestinationWithDatabase,
};
