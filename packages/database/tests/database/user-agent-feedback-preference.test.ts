import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const MIGRATION = readFileSync(
  new URL("../../drizzle/0112_user_agent_feedback_preference.sql", import.meta.url),
  "utf8",
);

const createDatabase = async () => {
  const client = new PGlite();
  await client.exec(`create table "user" ("id" text primary key);`);
  await client.exec(`insert into "user" ("id") values ('existing-user');`);
  await client.exec(MIGRATION);
  return client;
};

const readPreference = async (client: PGlite, userId: string) => {
  const { rows } = await client.query<{ agentFeedbackEnabled: boolean }>(
    `select "agentFeedbackEnabled" from "user" where "id" = $1`,
    [userId],
  );
  return rows[0]?.agentFeedbackEnabled;
};

describe("user agent feedback preference migration", () => {
  it("leaves agent feedback on for users who signed up before it existed", async () => {
    const client = await createDatabase();

    expect(await readPreference(client, "existing-user")).toBe(true);
  });

  it("turns agent feedback on for new users", async () => {
    const client = await createDatabase();
    await client.exec(`insert into "user" ("id") values ('new-user');`);

    expect(await readPreference(client, "new-user")).toBe(true);
  });

  it("keeps a user's opt-out", async () => {
    const client = await createDatabase();
    await client.exec(`update "user" set "agentFeedbackEnabled" = false where "id" = 'existing-user';`);

    expect(await readPreference(client, "existing-user")).toBe(false);
  });

  it("refuses to store no preference at all", async () => {
    const client = await createDatabase();

    await expect(
      client.exec(`update "user" set "agentFeedbackEnabled" = null where "id" = 'existing-user';`),
    ).rejects.toThrow();
  });

  it("applies cleanly a second time", async () => {
    const client = await createDatabase();

    await expect(client.exec(MIGRATION)).resolves.toBeDefined();
  });
});
