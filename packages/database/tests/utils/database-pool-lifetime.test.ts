import { describe, expect, it } from "vitest";
import { SQL } from "bun";
import { closeDatabase, createDatabase } from "../../src/utils/database";

const TEST_DATABASE_URL = process.env.KEEPER_TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)("pool max lifetime with a query in flight", () => {
  it("lets a healthy in-flight query outlive a non-zero maxLifetime, then replaces the connection", async () => {
    const sql = new SQL({ max: 1, maxLifetime: 1, prepare: false, url: TEST_DATABASE_URL });
    try {
      await sql.unsafe("select 1", []);
      await Bun.sleep(200);
      const [inFlight] = (await sql.unsafe(
        "select pg_sleep(2), pg_backend_pid() as pid, 'survived' as outcome",
        [],
      )) as { outcome: string; pid: number }[];
      const [next] = (await sql.unsafe("select pg_backend_pid() as pid", [])) as { pid: number }[];
      expect(inFlight?.outcome).toBe("survived");
      expect(next?.pid).toBeTypeOf("number");
      expect(next?.pid).not.toBe(inFlight?.pid);
    } finally {
      await sql.close();
    }
  }, 15_000);

  it("lets a healthy in-flight query outlive idleTimeout, then closes the connection once it is idle", async () => {
    const sql = new SQL({ idleTimeout: 1, max: 1, prepare: false, url: TEST_DATABASE_URL });
    try {
      const [inFlight] = (await sql.unsafe(
        "select pg_sleep(2), pg_backend_pid() as pid, 'survived' as outcome",
        [],
      )) as { outcome: string; pid: number }[];
      await Bun.sleep(2000);
      const [next] = (await sql.unsafe("select pg_backend_pid() as pid", [])) as { pid: number }[];
      expect(inFlight?.outcome).toBe("survived");
      expect(next?.pid).toBeTypeOf("number");
      expect(next?.pid).not.toBe(inFlight?.pid);
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
