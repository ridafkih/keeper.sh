import { calendarAccountsTable, calendarsTable } from "@keeper.sh/database/schema";
import { describe, expect, it } from "vitest";
import { clearSourceReauthentication } from "../../src/utils/source-reauthentication";
import type { SourceReauthenticationDatabase } from "../../src/utils/source-reauthentication";

const CREDENTIAL_ID = "2012e09b-5efc-4698-b86e-ad25b76279ba";
const ACCOUNT_ID = "3b01def5-590d-43ae-b81a-f4af6ba953e7";

interface UpdateCall {
  table: string;
  values: Record<string, unknown>;
}

const resolveTableName = (table: unknown): string => {
  if (table === calendarAccountsTable) {
    return "calendar_accounts";
  }
  if (table === calendarsTable) {
    return "calendars";
  }
  throw new Error("Unexpected table in source reauthentication update");
};

const createDatabaseStub = (accountIds: string[]) => {
  const updates: UpdateCall[] = [];

  const databaseClient = {
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => {
        updates.push({ table: resolveTableName(table), values });
        const where = () => {
          const result = Promise.resolve(accountIds.map((id) => ({ id })));
          return Object.assign(result, { returning: () => result });
        };
        return { where };
      },
    }),
  } as unknown as SourceReauthenticationDatabase;

  return { databaseClient, updates };
};

describe("clearSourceReauthentication", () => {
  it("clears the sticky reauthentication flag and both backoff clocks on reconnect", async () => {
    const { databaseClient, updates } = createDatabaseStub([ACCOUNT_ID]);

    await clearSourceReauthentication(databaseClient, CREDENTIAL_ID);

    expect(updates).toEqual([
      { table: "calendar_accounts", values: { needsReauthentication: false } },
      {
        table: "calendars",
        values: {
          failureCount: 0,
          lastFailureAt: null,
          nextAttemptAt: null,
          ingestFailureCount: 0,
          ingestLastFailureAt: null,
          ingestNextAttemptAt: null,
        },
      },
    ]);
  });

  it("leaves calendars alone when the credential backs no account", async () => {
    const { databaseClient, updates } = createDatabaseStub([]);

    await clearSourceReauthentication(databaseClient, CREDENTIAL_ID);

    expect(updates).toEqual([
      { table: "calendar_accounts", values: { needsReauthentication: false } },
    ]);
  });
});
