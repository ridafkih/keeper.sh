import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { drizzle } from "drizzle-orm/pglite";
import { describe, expect, it } from "vitest";
import { recordUserMilestone } from "../../src/database/user-milestones";

const MIGRATION = readFileSync(new URL("../../drizzle/0106_user_milestones.sql", import.meta.url), "utf8")
  .split("--> statement-breakpoint")
  .join("\n");

const createDatabase = async () => {
  const client = new PGlite();
  await client.exec(`create table "user" ("id" text primary key);`);
  await client.exec(MIGRATION);
  await client.exec(`insert into "user" ("id") values ('user-1'), ('user-2');`);
  return drizzle(client) as unknown as BunSQLDatabase;
};

describe("recordUserMilestone", () => {
  it("reports the first time a user reaches a milestone", async () => {
    const database = await createDatabase();

    expect(await recordUserMilestone(database, "user-1", "first_calendar_connected")).toBe(true);
  });

  it("reports nothing new when the user reaches it again", async () => {
    const database = await createDatabase();
    await recordUserMilestone(database, "user-1", "first_calendar_connected");

    expect(await recordUserMilestone(database, "user-1", "first_calendar_connected")).toBe(false);
  });

  it("tracks each milestone and each user separately", async () => {
    const database = await createDatabase();
    await recordUserMilestone(database, "user-1", "first_calendar_connected");

    expect(await recordUserMilestone(database, "user-1", "first_sync_created")).toBe(true);
    expect(await recordUserMilestone(database, "user-2", "first_calendar_connected")).toBe(true);
  });
});
