import { describe, expect, it } from "vitest";
import { SQL } from "bun";
import { closeDatabase, createDatabase } from "../../src/utils/database";

const TEST_DATABASE_URL = process.env.KEEPER_TEST_DATABASE_URL;

/*
 * Bun 1.3.14 retires a pooled connection the instant maxLifetime elapses, even
 * with a query in flight: onMaxLifetimeTimeout never consults hasQueryRunning,
 * so the healthy query dies with ERR_POSTGRES_LIFETIME_TIMEOUT and nothing
 * retries it (oven-sh/bun#30646; fix #30648 unmerged as of 1.3.14). Production
 * saw this kill better-auth session reads every ~30 minutes, turning every
 * authed route into a 500. The only safe value is 0; these tests pin both the
 * driver defect and the production pool configuration that avoids it.
 */
describe.skipIf(!TEST_DATABASE_URL)("pool max lifetime with a query in flight", () => {
  it("kills a healthy in-flight query when a non-zero maxLifetime elapses", async () => {
    const sql = new SQL({ max: 1, maxLifetime: 1, prepare: false, url: TEST_DATABASE_URL });
    try {
      await sql.unsafe("select 1", []);
      await Bun.sleep(200);
      const failure = await sql.unsafe("select pg_sleep(2)", []).then(
        () => null,
        (error: unknown) => error,
      );
      expect(failure).not.toBeNull();
      expect((failure as { code?: string }).code).toBe("ERR_POSTGRES_LIFETIME_TIMEOUT");
    } finally {
      await sql.close();
    }
  }, 15_000);

  it("keeps connection retirement by age disabled in the production pool", async () => {
    const database = await createDatabase(TEST_DATABASE_URL ?? "");
    try {
      expect(database.$client.options.maxLifetime).toBe(0);
    } finally {
      closeDatabase(database);
    }
  }, 15_000);

  it("leaves in-flight queries untouched when maxLifetime is disabled", async () => {
    const unretired = new SQL({ max: 1, maxLifetime: 0, prepare: false, url: TEST_DATABASE_URL });
    try {
      await unretired.unsafe("select 1", []);
      const [row] = (await unretired.unsafe(
        "select pg_sleep(1.5), 'survived' as outcome",
        [],
      )) as { outcome: string }[];
      expect(row?.outcome).toBe("survived");
    } finally {
      await unretired.close();
    }
  }, 15_000);
});
