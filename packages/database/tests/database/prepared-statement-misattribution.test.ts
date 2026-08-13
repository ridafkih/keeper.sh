import { describe, expect, it } from "vitest";
import { SQL } from "bun";

const TEST_DATABASE_URL = process.env.KEEPER_TEST_DATABASE_URL;

const SELECT_RANGES = `select "syncFutureRange", "syncHistoricRange"
  from keeper_prepare_probe limit 1`;

/*
 * Bun 1.3.14 can deliver one query's DataRows to a different query on the same
 * connection, so a read comes back holding an unrelated statement's payload.
 * Prepared statements are disabled in createDatabase to avoid it; this pins that
 * decision by driving the interleaving that triggers it. Re-enabling prepared
 * statements makes this fail rather than silently corrupting reads in production.
 */
describe.skipIf(!TEST_DATABASE_URL)("interleaved statements keep their own results", () => {
  it("never returns another statement's payload to a select", async () => {
    const sql = new SQL({ max: 1, prepare: false, url: TEST_DATABASE_URL });
    try {
      await sql.unsafe(`create temporary table keeper_prepare_probe(
        "syncFutureRange" text, "syncHistoricRange" text)`, []);
      await sql.unsafe(
        `insert into keeper_prepare_probe values ('2_years', '1_month')`,
        [],
      );
      for (let warmup = 0; warmup < 20; warmup++) {
        await sql.unsafe(SELECT_RANGES, []);
      }

      const rows: Record<string, unknown>[] = [];
      for (let round = 0; round < 50; round++) {
        const settled = await Promise.all([
          sql.unsafe(`select set_config('statement_timeout', $1, true)`, [String(110_000 + round)]),
          sql.unsafe(SELECT_RANGES, []),
          sql.unsafe(`select pg_advisory_xact_lock($1, hashtext($2))`, [1234, `probe-${round}`]),
          sql.unsafe(SELECT_RANGES, []),
        ]);
        rows.push(
          (settled[1] as Record<string, unknown>[])[0] ?? {},
          (settled[3] as Record<string, unknown>[])[0] ?? {},
        );
      }

      for (const row of rows) {
        expect(row).toEqual({ syncFutureRange: "2_years", syncHistoricRange: "1_month" });
      }
    } finally {
      await sql.close();
    }
  });
});
