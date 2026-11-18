import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SQL } from "bun";
import { closeDatabase, createDatabase } from "@keeper.sh/database";
import { REAUTHENTICATION_EMAIL_GRACE_MS } from "@keeper.sh/constants";
import {
  resolveReauthenticationEmailConfig,
  runReauthenticationNotices,
} from "../../src/utils/reauthentication-notice";
import type { ReauthenticationEmail } from "../../src/utils/reauthentication-notice";

const administrativeUrl = process.env.KEEPER_TEST_DATABASE_URL;
const migrationScript = `${import.meta.dirname}/../../../../packages/database/scripts/migrate.ts`;
const databaseName = `keeper_cron_reauth_notice_${process.pid}`;
const START = new Date("2026-11-18T00:00:00.000Z");
const AFTER_GRACE = new Date(START.getTime() + REAUTHENTICATION_EMAIL_GRACE_MS);

const buildDatabaseUrl = (name: string): string => {
  const url = new URL(administrativeUrl ?? "postgres://localhost");
  url.pathname = `/${name}`;
  return url.toString();
};

const withAdministrativeClient = async (run: (client: SQL) => Promise<void>): Promise<void> => {
  const client = new SQL(administrativeUrl ?? "");
  try {
    await run(client);
  } finally {
    await client.close();
  }
};

describe.skipIf(!administrativeUrl)("reconnect emails against Postgres", () => {
  let client: SQL | null = null;
  let database: Awaited<ReturnType<typeof createDatabase>> | null = null;
  let accountId = "";
  const sent: ReauthenticationEmail[] = [];

  const connected = () => {
    if (!client || !database) {
      throw new Error("database not ready");
    }
    return { client, database };
  };

  const run = (now: Date, send = (email: ReauthenticationEmail) => {
    sent.push(email);
    return Promise.resolve();
  }) => runReauthenticationNotices({
    database: connected().database,
    linkBaseUrl: "https://keeper.example.com",
    now,
    send,
    templateId: "calendar-reconnect",
  });

  const setFlag = (needsReauthentication: boolean) =>
    connected().client`UPDATE "calendar_accounts" SET "needsReauthentication" = ${needsReauthentication} WHERE "id" = ${accountId}::uuid`;

  beforeAll(async () => {
    await withAdministrativeClient(async (admin) => {
      await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}"`);
      await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
    });
    const migrated = await Bun.$`bun ${migrationScript}`
      .env({ ...process.env, DATABASE_URL: buildDatabaseUrl(databaseName) })
      .quiet()
      .nothrow();
    if (migrated.exitCode !== 0) {
      throw new Error(`Migration failed: ${migrated.stderr.toString()}`);
    }
    client = new SQL(buildDatabaseUrl(databaseName));
    database = await createDatabase(buildDatabaseUrl(databaseName), { maxConnections: 4 });
  }, 300_000);

  afterAll(async () => {
    if (database) {
      closeDatabase(database, { graceSeconds: 1 });
    }
    await client?.close();
    await withAdministrativeClient(async (admin) => {
      await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    });
  }, 120_000);

  beforeEach(async () => {
    sent.length = 0;
    const { client: sql } = connected();
    await sql`DELETE FROM "user"`;
    await sql`INSERT INTO "user" ("id", "email", "name", "emailVerified") VALUES ('owner', 'owner@example.com', 'Owner', true)`;
    const [account] = await sql<{ id: string }[]>`
      INSERT INTO "calendar_accounts" ("authType", "email", "needsReauthentication", "provider", "userId")
      VALUES ('oauth', 'work@example.com', true, 'google', 'owner') RETURNING "id"
    `;
    accountId = account?.id ?? "";
  });

  it("waits out the grace period before the first email", async () => {
    await run(START);

    expect(sent).toEqual([]);
  });

  it("emails once with a link to reconnect that account", async () => {
    await run(START);
    await run(AFTER_GRACE);
    await run(new Date(AFTER_GRACE.getTime() + 60_000));

    expect(sent).toEqual([{
      template: {
        id: "calendar-reconnect",
        variables: {
          accountLabel: "work@example.com",
          name: "Owner",
          provider: "Google Calendar",
          url: `https://keeper.example.com/dashboard/accounts/${accountId}/reconnect`,
        },
      },
      to: "owner@example.com",
    }]);
  });

  it("emails again after the account recovers and is flagged a second time", async () => {
    await run(START);
    await run(AFTER_GRACE);
    await setFlag(false);
    const recoveredAt = new Date(AFTER_GRACE.getTime() + 60_000);
    await run(recoveredAt);
    await setFlag(true);
    await run(recoveredAt);
    await run(new Date(recoveredAt.getTime() + REAUTHENTICATION_EMAIL_GRACE_MS));

    expect(sent).toHaveLength(2);
  });

  it("never emails an account that recovers within the grace period", async () => {
    await run(START);
    await setFlag(false);
    await run(new Date(START.getTime() + 60_000));
    await setFlag(true);
    await run(new Date(START.getTime() + 120_000));
    await run(AFTER_GRACE);

    expect(sent).toEqual([]);
  });

  it("retries on the next run when the send fails", async () => {
    await run(START);
    const result = await run(AFTER_GRACE, () => Promise.reject(new Error("resend down")));
    await run(new Date(AFTER_GRACE.getTime() + 60_000));

    expect(result.failures).toHaveLength(1);
    expect(sent).toHaveLength(1);
  });

  it("does not email an address its owner never verified", async () => {
    await connected().client`UPDATE "user" SET "emailVerified" = false`;
    await run(START);
    await run(AFTER_GRACE);

    expect(sent).toEqual([]);
  });
});

describe("reconnect email configuration", () => {
  it("is off when no template is configured", () => {
    expect(resolveReauthenticationEmailConfig({ RESEND_API_KEY: "key" })).toBeNull();
  });

  it("refuses a template it could not send or link", () => {
    expect(() => resolveReauthenticationEmailConfig({
      BETTER_AUTH_URL: "https://keeper.example.com",
      REAUTHENTICATION_EMAIL_TEMPLATE_ID: "calendar-reconnect",
    })).toThrow("RESEND_API_KEY");
    expect(() => resolveReauthenticationEmailConfig({
      REAUTHENTICATION_EMAIL_TEMPLATE_ID: "calendar-reconnect",
      RESEND_API_KEY: "key",
    })).toThrow("BETTER_AUTH_URL");
  });
});
