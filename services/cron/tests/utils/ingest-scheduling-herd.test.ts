import { describe, expect, it } from "vitest";
import { allSettledGroupedWithConcurrency } from "@keeper.sh/calendar";

/*
 * The cron container runs with DATABASE_POOL_MAX 25 (deploy/compose.yaml), and
 * every launched source task performs pooled reads BEFORE the weighted
 * reserve() can park it: the backoff attempt read, the currentSource re-read,
 * getRequiredSourceRanges, and the estimator's count(*) on event_states. The
 * scheduler is therefore the only thing that can bound how many of those
 * pre-reserve reads race the pool at the top of a pass. This test drives the
 * real group scheduler with the production options from
 * src/jobs/ingest-sources.ts (USER_GROUP_CONCURRENCY groups at
 * USER_CALENDAR_CONCURRENCY tasks each) and requires the peak number of
 * simultaneously launched source tasks to stay within the pool.
 */

const CRON_DATABASE_POOL_MAX = 25;

const INGEST_SOURCES_PATH = new URL(
  "../../src/jobs/ingest-sources.ts",
  import.meta.url,
).pathname;

const readProductionConstant = (source: string, name: string): number => {
  const match = source.match(new RegExp(`const ${name} = (\\d[\\d_]*);`));
  if (!match?.[1]) {
    throw new Error(`${name} not found in ingest-sources.ts`);
  }
  return Number(match[1].replaceAll("_", ""));
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

describe("per-pass ingest scheduling", () => {
  it("keeps concurrently launched source tasks within the database pool", async () => {
    const source = await Bun.file(INGEST_SOURCES_PATH).text();
    const groupConcurrency = readProductionConstant(source, "USER_GROUP_CONCURRENCY");
    const taskConcurrency = readProductionConstant(source, "USER_CALENDAR_CONCURRENCY");

    /*
     * A full fleet pass: every user group carries taskConcurrency sources, the
     * shape that maximises simultaneous launches under the grouped scheduler.
     */
    const userCount = groupConcurrency;
    const tasks: (() => Promise<void>)[] = [];
    const groupKeys: string[] = [];

    let inFlight = 0;
    let peakInFlight = 0;

    for (let userIndex = 0; userIndex < userCount; userIndex++) {
      for (let sourceIndex = 0; sourceIndex < taskConcurrency; sourceIndex++) {
        groupKeys.push(`user-${userIndex}`);
        // eslint-disable-next-line no-loop-func -- The shared counters ARE the measurement; per repo precedent in tests/migration-check.test.ts.
        tasks.push(async () => {
          /*
           * Stand-in for the pre-reserve pooled read sequence: the task counts
           * as in flight from launch until its first reads would have finished.
           */
          inFlight++;
          peakInFlight = Math.max(peakInFlight, inFlight);
          await sleep(5);
          inFlight--;
        });
      }
    }

    await allSettledGroupedWithConcurrency(tasks, groupKeys, {
      groupConcurrency,
      taskConcurrency,
    });

    expect(peakInFlight).toBeLessThanOrEqual(CRON_DATABASE_POOL_MAX);
  });
});
