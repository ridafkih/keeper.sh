import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const client = new PGlite();
const database = drizzle(client);

const listOutlookCalendars = vi.fn(() => Promise.resolve([]));

vi.mock("@/context", () => ({ database, googleInteractiveRateLimiter: null }));
vi.mock("../../src/utils/safe-fetch-options", () => ({ safeFetchOptions: {} }));
vi.mock("@keeper.sh/calendar/outlook", () => ({ listUserCalendars: listOutlookCalendars }));

const { discoverOAuthAccountCalendars, discoverOAuthCredentialCalendars } = await import(
  "../../src/utils/account-calendar-discovery"
);

const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const CREDENTIAL_ID = "22222222-2222-4222-8222-222222222222";

const DDL = `
create table oauth_credentials (
  "id" uuid primary key,
  "accessToken" text not null,
  "email" text,
  "expiresAt" timestamptz not null,
  "refreshToken" text not null,
  "userId" text not null
);
create table calendar_accounts (
  "id" uuid primary key,
  "oauthCredentialId" uuid
);
insert into oauth_credentials ("id", "accessToken", "email", "expiresAt", "refreshToken", "userId")
values ('${CREDENTIAL_ID}', 'token', 'me@example.com', now() + interval '1 hour', 'refresh', 'user-1');
insert into calendar_accounts ("id", "oauthCredentialId") values ('${ACCOUNT_ID}', '${CREDENTIAL_ID}');
`;

describe("Outlook calendar discovery owner filter", () => {
  beforeAll(async () => {
    await client.exec(DDL);
  });

  beforeEach(() => {
    listOutlookCalendars.mockClear();
  });

  it("passes the account email when discovering by account", async () => {
    await discoverOAuthAccountCalendars(ACCOUNT_ID, "outlook");
    expect(listOutlookCalendars).toHaveBeenCalledWith("token", { ownerEmail: "me@example.com" });
  });

  it("passes the account email when discovering by credential", async () => {
    await discoverOAuthCredentialCalendars("user-1", CREDENTIAL_ID, "outlook");
    expect(listOutlookCalendars).toHaveBeenCalledWith("token", { ownerEmail: "me@example.com" });
  });
});
