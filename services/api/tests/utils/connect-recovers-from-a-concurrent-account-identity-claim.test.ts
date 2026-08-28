import { getDatabaseErrorDetails } from "@keeper.sh/database";
import { describe, expect, it } from "vitest";
import { createOAuthSourceWithDependencies } from "../../src/utils/oauth-sources";

const PROVIDER_ACCOUNT_ID = "google-sub-7";
const SIBLING_ACCOUNT_ROW_ID = "sibling-account-row";

const uniqueViolation = () =>
  Object.assign(
    new Error(
      'duplicate key value violates unique constraint "calendar_accounts_provider_account_idx"',
    ),
    {
      code: "ERR_POSTGRES_SERVER_ERROR",
      constraint: "calendar_accounts_provider_account_idx",
      detail: `Key ("userId", provider, "accountId")=(user-1, google, ${PROVIDER_ACCOUNT_ID}) already exists.`,
      errno: "23505",
    },
  );

const connectOptions = {
  externalCalendarId: "external-1",
  name: "Team Calendar",
  oauthCredentialId: "credential-1",
  provider: "google",
  providerAccountId: PROVIDER_ACCOUNT_ID,
  userId: "user-1",
};

interface Recorder {
  createAccountCalls: unknown[];
  createSourceCalls: { accountId: string }[];
  lookupCalls: number;
}

const createDependencies = (
  recorder: Recorder,
  reReadResult: string | null,
  insertError: unknown,
) => ({
  adoptProviderAccountId: () => Promise.resolve(),
  canAddAccount: () => Promise.resolve(true),
  countUserAccounts: () => Promise.resolve(0),
  createCalendarAccount: (payload: unknown) => {
    recorder.createAccountCalls.push(payload);
    return Promise.reject(insertError);
  },
  createSource: (payload: { accountId: string }) => {
    recorder.createSourceCalls.push(payload);
    return Promise.resolve({ id: "source-1", name: "Team Calendar" });
  },
  findCredentialEmail: () => Promise.resolve({ email: "person@example.com", exists: true }),
  findExistingAccountId: () => {
    recorder.lookupCalls += 1;
    if (recorder.lookupCalls === 1) {
      return Promise.resolve(null);
    }
    return Promise.resolve(reReadResult);
  },
  hasExistingCalendar: () => Promise.resolve(false),
  triggerSync: () => null,
});

describe("the connect path meeting a concurrent claim on the provider account id", () => {
  it("shapes its unique violation the way a real postgres driver would", () => {
    const details = getDatabaseErrorDetails(uniqueViolation());
    expect(details?.sqlState).toBe("23505");
    expect(details?.constraint).toBe("calendar_accounts_provider_account_idx");
  });

  it("recovers by continuing with the row that now holds the identity", async () => {
    const recorder: Recorder = {
      createAccountCalls: [],
      createSourceCalls: [],
      lookupCalls: 0,
    };

    const source = await createOAuthSourceWithDependencies(
      connectOptions,
      createDependencies(recorder, SIBLING_ACCOUNT_ROW_ID, uniqueViolation()),
    );

    expect(source).toEqual({
      email: "person@example.com",
      id: "source-1",
      name: "Team Calendar",
      provider: "google",
    });
    expect(recorder.createAccountCalls).toHaveLength(1);
    expect(recorder.createSourceCalls).toEqual([
      expect.objectContaining({ accountId: SIBLING_ACCOUNT_ROW_ID }),
    ]);
  });

  it("propagates the unique violation when no row holds the identity on the re-read", async () => {
    const recorder: Recorder = {
      createAccountCalls: [],
      createSourceCalls: [],
      lookupCalls: 0,
    };
    const insertError = uniqueViolation();

    await expect(
      createOAuthSourceWithDependencies(
        connectOptions,
        createDependencies(recorder, null, insertError),
      ),
    ).rejects.toBe(insertError);

    expect(recorder.createSourceCalls).toHaveLength(0);
  });
});
