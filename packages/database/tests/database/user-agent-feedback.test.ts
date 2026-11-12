import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { drizzle } from "drizzle-orm/pglite";
import { describe, expect, it } from "vitest";
import { readUserAgentFeedbackEnabled } from "../../src/database/user-agent-feedback";

const MIGRATION = readFileSync(
  new URL("../../drizzle/0112_user_agent_feedback_preference.sql", import.meta.url),
  "utf8",
);

const createDatabase = async () => {
  const client = new PGlite();
  await client.exec(`create table "user" ("id" text primary key);`);
  await client.exec(MIGRATION);
  await client.exec(`insert into "user" ("id") values ('opted-in'), ('opted-out');`);
  await client.exec(`update "user" set "agentFeedbackEnabled" = false where "id" = 'opted-out';`);
  return drizzle(client) as unknown as BunSQLDatabase;
};

describe("readUserAgentFeedbackEnabled", () => {
  it("reads a user who left agent feedback on", async () => {
    expect(await readUserAgentFeedbackEnabled(await createDatabase(), "opted-in")).toBe(true);
  });

  it("reads a user who opted out", async () => {
    expect(await readUserAgentFeedbackEnabled(await createDatabase(), "opted-out")).toBe(false);
  });

  it("fails loudly for a user that does not exist", async () => {
    await expect(readUserAgentFeedbackEnabled(await createDatabase(), "nobody")).rejects.toThrow("nobody");
  });
});
