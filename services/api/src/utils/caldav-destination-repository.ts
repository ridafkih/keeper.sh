import {
  caldavCredentialsTable,
  calendarAccountsTable,
  calendarsTable,
} from "@keeper.sh/database/schema";
import { eq } from "drizzle-orm";
import {
  CalDAVCredentialCreateError,
  DestinationAccountCreateError,
} from "./destination-errors";
import {
  findExistingDestinationAccountWithDatabase,
  findMappedDestinationCalendarForAccountIdWithDatabase,
  initializeDestinationSyncStatusWithDatabase,
  setupNewDestinationWithDatabase,
  validateDestinationAccountOwnership,
  type DestinationDatabase,
} from "./destination-account-repository";

const saveCalDAVDestinationWithDatabase = async (
  databaseClient: DestinationDatabase,
  userId: string,
  provider: string,
  accountId: string,
  email: string,
  serverUrl: string,
  calendarUrl: string,
  username: string,
  encryptedPassword: string,
): Promise<void> => {
  const existingAccount = await findExistingDestinationAccountWithDatabase(
    databaseClient,
    provider,
    accountId,
  );
  validateDestinationAccountOwnership(existingAccount, userId);

  if (existingAccount?.caldavCredentialId) {
    await databaseClient
      .update(caldavCredentialsTable)
      .set({ encryptedPassword, serverUrl, username })
      .where(eq(caldavCredentialsTable.id, existingAccount.caldavCredentialId));

    await databaseClient
      .update(calendarAccountsTable)
      .set({ email })
      .where(eq(calendarAccountsTable.id, existingAccount.id));

    const existingCalendar = await findMappedDestinationCalendarForAccountIdWithDatabase(
      databaseClient,
      existingAccount.id,
    );
    if (existingCalendar) {
      await databaseClient
        .update(calendarsTable)
        .set({ calendarUrl })
        .where(eq(calendarsTable.id, existingCalendar.id));
      await initializeDestinationSyncStatusWithDatabase(databaseClient, existingCalendar.id);
    }
    return;
  }

  const [credential] = await databaseClient
    .insert(caldavCredentialsTable)
    .values({ encryptedPassword, serverUrl, username })
    .returning({ id: caldavCredentialsTable.id });

  if (!credential) {
    throw new CalDAVCredentialCreateError();
  }

  const [account] = await databaseClient
    .insert(calendarAccountsTable)
    .values({
      accountId,
      authType: "caldav",
      caldavCredentialId: credential.id,
      email,
      provider,
      userId,
    })
    .returning({ id: calendarAccountsTable.id });

  if (!account) {
    throw new DestinationAccountCreateError();
  }

  const [calendar] = await databaseClient
    .insert(calendarsTable)
    .values({
      accountId: account.id,
      calendarType: "caldav",
      capabilities: ["pull", "push"],
      calendarUrl,
      name: `${provider} destination`,
      userId,
    })
    .returning({ id: calendarsTable.id });

  if (calendar) {
    await setupNewDestinationWithDatabase(databaseClient, calendar.id);
  }
};

export {
  saveCalDAVDestinationWithDatabase,
};
