import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { closeDatabase, createDatabase } from "../../src/index";

const TEST_DATABASE_URL = process.env.KEEPER_TEST_DATABASE_URL;

/*
 * Issue #974 reports keeper-standalone exceeding Postgres max_connections with every
 * client pool capped low, which would make pool sizing a mask rather than a fix. The claim
 * is that a same-tick burst of acquisitions opens backends past `max`; measured against a
 * real server it does not. Equality keeps the probe honest: a pool that stopped saturating
 * would fail it just as a pool that overshot would.
 */
const POOL_MAX = 2;
const BURST_SIZE = 50;
const QUERY_SECONDS = 0.5;
const SAMPLE_INTERVAL_MS = 20;
const APPLICATION_NAME = "keeper-pool-burst-probe";

const probeUrl = (): string => {
  const url = new URL(TEST_DATABASE_URL as string);
  url.searchParams.set("application_name", APPLICATION_NAME);
  return url.toString();
};

const sleep = (delayMs: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });

const countProbeBackends = async (observer: Client): Promise<number> => {
  const result = await observer.query<{ count: string }>(
    "SELECT count(*) AS count FROM pg_stat_activity WHERE application_name = $1",
    [APPLICATION_NAME],
  );
  return Number(result.rows[0]?.count ?? 0);
};

describe.skipIf(!TEST_DATABASE_URL)("connection pool under a same-tick acquisition burst", () => {
  it("never opens more backends than the pool maximum", async () => {
    const observer = new Client({ connectionString: TEST_DATABASE_URL });
    await observer.connect();

    const database = await createDatabase(probeUrl(), {
      maxConnections: POOL_MAX,
      statementTimeoutMs: 60_000,
    });

    const state = { peak: 0, sampling: true };
    const sampler = (async () => {
      while (state.sampling) {
        state.peak = Math.max(state.peak, await countProbeBackends(observer));
        await sleep(SAMPLE_INTERVAL_MS);
      }
    })();

    try {
      const burst = Array.from({ length: BURST_SIZE }, () =>
        database.execute(`select pg_sleep(${QUERY_SECONDS})`),
      );
      await Promise.all(burst);
    } finally {
      state.sampling = false;
      await sampler;
      closeDatabase(database, { graceSeconds: 1 });
      await observer.end();
    }

    expect(state.peak).toBe(POOL_MAX);
  }, 60_000);
});
