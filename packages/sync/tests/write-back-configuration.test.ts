import { describe, expect, it } from "vitest";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { resolveSourceWriter } from "../src/write-back";
import type { WriteBackApplierConfig } from "../src/write-back";

const SOURCE_CALENDAR_ID = "source-calendar-id";

const CALDAV_CREDENTIALS = {
  authMethod: "Basic",
  calendarUrl: "https://caldav.example.com/calendar/",
  encryptedPassword: "encrypted",
  serverUrl: "https://caldav.example.com",
  username: "user",
};

const OAUTH_CREDENTIALS = {
  accessToken: "access-token",
  accountId: "account-id",
  credentialId: "credential-id",
  expiresAt: new Date("2000-01-01T00:00:00.000Z"),
  externalCalendarId: "primary",
  refreshToken: "refresh-token",
};

const COMPLETE_OAUTH_CONFIG = {
  googleClientId: "google-client-id",
  googleClientSecret: "google-client-secret",
  microsoftClientId: "microsoft-client-id",
  microsoftClientSecret: "microsoft-client-secret",
};

const createChain = (rows: Record<string, unknown>[]): Record<string, unknown> => {
  const chain: Record<string, unknown> = {
    from: () => chain,
    innerJoin: () => chain,
    leftJoin: () => chain,
    limit: () => Promise.resolve(rows),
    where: () => chain,
  };
  return chain;
};

const createDatabase = (
  provider: string,
  credentials: Record<string, unknown>,
): BunSQLDatabase => {
  const answers = [[{ provider }], [credentials]];
  return {
    select: () => createChain(answers.shift() ?? []),
  } as unknown as BunSQLDatabase;
};

const createConfig = (
  oauthConfig: Record<string, string>,
  database: BunSQLDatabase,
): WriteBackApplierConfig => ({
  database,
  oauthConfig,
  userId: "user-id",
});

const withoutField = (field: string): Record<string, string> =>
  Object.fromEntries(
    Object.entries(COMPLETE_OAUTH_CONFIG).filter(([key]) => key !== field),
  );

describe("a source nobody is configured to reach is reported, never quietly attempted", () => {
  it("refuses a CalDAV source write when no encryption key is configured", async () => {
    const database = createDatabase("caldav", CALDAV_CREDENTIALS);

    await expect(resolveSourceWriter(
      createConfig(COMPLETE_OAUTH_CONFIG, database),
      SOURCE_CALENDAR_ID,
    )).rejects.toThrow(/encryption key/);
  });

  it.each([
    ["google", "googleClientId"],
    ["google", "googleClientSecret"],
    ["outlook", "microsoftClientId"],
    ["outlook", "microsoftClientSecret"],
  ] as const)(
    "refuses a %s source write when %s is missing",
    async (provider, field) => {
      const database = createDatabase(provider, OAUTH_CREDENTIALS);

      await expect(resolveSourceWriter(
        createConfig(withoutField(field), database),
        SOURCE_CALENDAR_ID,
      )).rejects.toThrow(new RegExp(field));
    },
  );

  it("builds a writer once the configuration is complete", async () => {
    const database = createDatabase("google", OAUTH_CREDENTIALS);

    await expect(resolveSourceWriter(
      createConfig(COMPLETE_OAUTH_CONFIG, database),
      SOURCE_CALENDAR_ID,
    )).resolves.toMatchObject({ deleteEvent: expect.any(Function) });
  });
});
