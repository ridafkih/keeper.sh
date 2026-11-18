import { describe, expect, it } from "vitest";
import { caldavCredentialsTable, oauthCredentialsTable } from "@keeper.sh/database/schema";
import { resolveCredentialsByCalendarId } from "../../src/mutations/resolve-credentials";
import type { KeeperDatabase } from "../../src/types";

const USER_ID = "user-1";
const CALENDAR_ID = "019c0000-0000-7000-8000-000000000001";
const OAUTH_CREDENTIAL_ID = "019c0000-0000-7000-8000-000000000002";
const CALDAV_CREDENTIAL_ID = "019c0000-0000-7000-8000-000000000003";

const storedAccessToken = (value: string) =>
  oauthCredentialsTable.accessToken.mapFromDriverValue(value);
const storedRefreshToken = (value: string) =>
  oauthCredentialsTable.refreshToken.mapFromDriverValue(value);
const storedPassword = (value: string) =>
  caldavCredentialsTable.encryptedPassword.mapFromDriverValue(value);

const baseRow = {
  accountId: "019c0000-0000-7000-8000-000000000004",
  caldavAuthMethod: null,
  caldavCredentialId: null,
  caldavEncryptedPassword: null,
  caldavServerUrl: null,
  caldavUsername: null,
  calendarId: CALENDAR_ID,
  calendarUrl: null,
  email: null,
  externalCalendarId: "primary",
  needsReauthentication: false,
  oauthAccessToken: null,
  oauthCredentialId: null,
  oauthExpiresAt: null,
  oauthRefreshToken: null,
  provider: "google",
};

const oauthRow = (accessToken: string, refreshToken: string) => ({
  ...baseRow,
  oauthAccessToken: storedAccessToken(accessToken),
  oauthCredentialId: OAUTH_CREDENTIAL_ID,
  oauthExpiresAt: new Date("2031-01-01T00:00:00.000Z"),
  oauthRefreshToken: storedRefreshToken(refreshToken),
});

const caldavRow = (password: string) => ({
  ...baseRow,
  caldavAuthMethod: "basic",
  caldavCredentialId: CALDAV_CREDENTIAL_ID,
  caldavEncryptedPassword: storedPassword(password),
  caldavServerUrl: "https://caldav.example.invalid/",
  caldavUsername: "person@example.invalid",
  provider: "caldav",
});

const databaseReturning = (row: Record<string, unknown>) =>
  ({
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          leftJoin: () => ({
            leftJoin: () => ({
              where: () => ({
                limit: () => Promise.resolve([row]),
              }),
            }),
          }),
        }),
      }),
    }),
  }) as unknown as KeeperDatabase;

const resolve = (row: Record<string, unknown>) =>
  resolveCredentialsByCalendarId(databaseReturning(row), USER_ID, CALENDAR_ID);

describe("resolving stored credentials for a calendar", () => {
  it("returns OAuth credentials when both tokens are stored", async () => {
    const credentials = await resolve(oauthRow("stored-access", "stored-refresh"));

    expect(credentials?.oauth?.credentialId).toBe(OAUTH_CREDENTIAL_ID);
  });

  it("returns no OAuth credentials when the stored access token is empty", async () => {
    const credentials = await resolve(oauthRow("", "stored-refresh"));

    expect(credentials?.oauth).toBeUndefined();
  });

  it("returns no OAuth credentials when the stored refresh token is empty", async () => {
    const credentials = await resolve(oauthRow("stored-access", ""));

    expect(credentials?.oauth).toBeUndefined();
  });

  it("returns CalDAV credentials when a password is stored", async () => {
    const credentials = await resolve(caldavRow("nonce:sealed"));

    expect(credentials?.caldav?.credentialId).toBe(CALDAV_CREDENTIAL_ID);
  });

  it("returns no CalDAV credentials when the stored password is empty", async () => {
    const credentials = await resolve(caldavRow(""));

    expect(credentials?.caldav).toBeUndefined();
  });
});
