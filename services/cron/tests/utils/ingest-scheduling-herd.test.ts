import { describe, expect, it } from "vitest";
import { allSettledGroupedWithConcurrency } from "@keeper.sh/calendar";

/*
 * Every launched source task does pooled reads BEFORE the weighted reserve()
 * can park it, so the scheduler is the only bound on how many of those reads
 * race the pool at the top of a pass.
 */

/* DATABASE_POOL_MAX for the cron container, from deploy/compose.yaml. */
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

const readGroupConcurrency = (source: string): number => Math.floor(
  readProductionConstant(source, "DEFAULT_DATABASE_POOL_MAX")
  / (
    readProductionConstant(source, "CONCURRENTLY_RUNNING_INGEST_FAMILIES")
    * readProductionConstant(source, "USER_CALENDAR_CONCURRENCY")
  ),
);

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

describe("per-pass ingest scheduling", () => {
  it("keeps concurrently launched source tasks within the database pool", async () => {
    const source = await Bun.file(INGEST_SOURCES_PATH).text();
    const groupConcurrency = readGroupConcurrency(source);
    const taskConcurrency = readProductionConstant(source, "USER_CALENDAR_CONCURRENCY");

    /* Full groups at full width: the shape that maximises simultaneous launches. */
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

    const concurrentFamilies = readProductionConstant(
      source,
      "CONCURRENTLY_RUNNING_INGEST_FAMILIES",
    );
    expect(peakInFlight * concurrentFamilies).toBeLessThanOrEqual(CRON_DATABASE_POOL_MAX);
  });
});
