import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { drizzle } from "drizzle-orm/pglite";
import { describe, expect, it } from "vitest";
import { recordUserSignUpAttribution } from "../../src/database/user-sign-up-attributions";

const MIGRATION = readFileSync(new URL("../../drizzle/0113_user_sign_up_attributions.sql", import.meta.url), "utf8")
  .split("--> statement-breakpoint")
  .join("\n");

const createDatabase = async () => {
  const client = new PGlite();
  await client.exec(`create table "user" ("id" text primary key);`);
  await client.exec(MIGRATION);
  await client.exec(`insert into "user" ("id") values ('user-1');`);
  return { client, database: drizzle(client) as unknown as BunSQLDatabase };
};

const readRows = async (client: PGlite) => {
  const result = await client.query<Record<string, string | null>>(`select "userId", "landingPath", "referrerOrigin", "utmSource", "utmMedium", "utmCampaign" from "user_sign_up_attributions"`);
  return result.rows;
};

describe("recordUserSignUpAttribution", () => {
  it("stores where a user came from", async () => {
    const { client, database } = await createDatabase();

    await recordUserSignUpAttribution(database, "user-1", {
      landingPath: "/compare/onecal",
      referrerOrigin: "https://www.google.com",
      utmSource: "google",
    });

    expect(await readRows(client)).toEqual([{
      landingPath: "/compare/onecal",
      referrerOrigin: "https://www.google.com",
      userId: "user-1",
      utmCampaign: null,
      utmMedium: null,
      utmSource: "google",
    }]);
  });

  it("keeps the first record when a user is attributed twice", async () => {
    const { client, database } = await createDatabase();

    await recordUserSignUpAttribution(database, "user-1", { landingPath: "/" });
    await recordUserSignUpAttribution(database, "user-1", { landingPath: "/pricing" });

    const rows = await readRows(client);
    expect(rows.map((row) => row.landingPath)).toEqual(["/"]);
  });

  it("goes when the user is deleted", async () => {
    const { client, database } = await createDatabase();
    await recordUserSignUpAttribution(database, "user-1", { landingPath: "/" });

    await client.exec(`delete from "user" where "id" = 'user-1'`);

    expect(await readRows(client)).toEqual([]);
  });

  it("applies twice without failing", async () => {
    const { client } = await createDatabase();

    await expect(client.exec(MIGRATION)).resolves.toBeDefined();
  });
});
