import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, describe, expect, it, vi } from "vitest";

const client = new PGlite();
const database = drizzle(client);

vi.mock("@/context", () => ({ database }));

const { resolveUserIdentifier } = await import("../../src/utils/user");

const DDL = `
create table "user" (
  "id" text primary key,
  "username" text unique
);
`;

const OWNER_ID = "AbCdEfGhIjKlMnOpQrStUvWxYz012345";
const OTHER_ID = "ZyXwVuTsRqPoNmLkJiHgFeDcBa543210";

describe("resolveUserIdentifier", () => {
  beforeAll(async () => {
    await client.exec(DDL);
    await client.query('insert into "user" ("id", "username") values ($1, $2)', [OWNER_ID, "owner"]);
    await client.query('insert into "user" ("id", "username") values ($1, $2)', [OTHER_ID, OWNER_ID]);
  });

  it("resolves a user id to that user even when another user's username matches it", async () => {
    await expect(resolveUserIdentifier(OWNER_ID)).resolves.toBe(OWNER_ID);
  });

  it("resolves a username that matches no user id", async () => {
    await expect(resolveUserIdentifier("owner")).resolves.toBe(OWNER_ID);
  });

  it("returns null for an identifier that is neither an id nor a username", async () => {
    await expect(resolveUserIdentifier("nobody")).resolves.toBeNull();
  });
});
