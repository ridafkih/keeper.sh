import { afterEach, describe, expect, it, vi } from "vitest";
import { fleetIngestLane, pushIngestLane } from "../../src/utils/ingest-lanes";
import { FLUSH_WRITER_CONNECTIONS } from "../../src/utils/flush-writer";

const CRON_DATABASE_POOL_MAX = 12;

vi.mock("../../src/env", () => ({ default: { DATABASE_POOL_MAX: CRON_DATABASE_POOL_MAX } }));
vi.mock("../../src/context", () => ({
  flushDrainRegistry: { register: (): null => null },
}));

const OVERSUBSCRIPTION = 64;
const SCHEDULING_SETTLE_MS = 20;
const PUSH_LANE_PATIENCE_MS = 50;

const releases: (() => void)[] = [];

const settleScheduledWork = async (): Promise<void> => {
  await new Promise<null>((resolve) => {
    setTimeout(() => resolve(null), SCHEDULING_SETTLE_MS);
  });
};

interface Occupancy {
  peak: number;
  settled: Promise<unknown>;
}

const createHold = (): { release: () => void; held: Promise<null> } => {
  const { promise, resolve } = Promise.withResolvers<null>();
  const release = (): void => resolve(null);
  releases.push(release);
  return { held: promise, release };
};

const occupyGate = async (
  gate: { run: <TResult>(operation: () => Promise<TResult>) => Promise<TResult> },
  attempts: number,
  held: Promise<null>,
): Promise<Occupancy> => {
  let peak = 0;
  const runs = Array.from({ length: attempts }, () =>
    gate.run(async () => {
      peak += 1;
      await held;
      return null;
    }));
  await settleScheduledWork();
  return { peak, settled: Promise.allSettled(runs) };
};

const occupyWriter = async (
  writer: { submit: (item: () => Promise<null>) => Promise<null> },
  attempts: number,
  held: Promise<null>,
): Promise<Occupancy> => {
  let active = 0;
  let peak = 0;
  const submissions = Array.from({ length: attempts }, () =>
    writer.submit(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await held;
      active -= 1;
      return null;
    }));
  await settleScheduledWork();
  return { peak, settled: Promise.allSettled(submissions) };
};

afterEach(async () => {
  for (const release of releases) {
    release();
  }
  releases.length = 0;
  await settleScheduledWork();
});

describe("the push ingest lane", () => {
  it("keeps its pooled-query permits when the fleet lane's gate is saturated", async () => {
    const hold = createHold();
    const fleet = await occupyGate(
      fleetIngestLane.pooledQueryGate,
      OVERSUBSCRIPTION,
      hold.held,
    );

    const outcome = await Promise.race([
      pushIngestLane.pooledQueryGate.run(async () => {
        await Promise.resolve(null);
        return "ran";
      }),
      new Promise<string>((resolve) => {
        setTimeout(() => resolve("blocked"), PUSH_LANE_PATIENCE_MS);
      }),
    ]);

    expect(fleet.peak).toBeGreaterThan(0);
    expect(outcome).toBe("ran");
  });

  it("holds a flush writer that is not the fleet lane's", () => {
    expect(pushIngestLane.flushWriter).not.toBe(fleetIngestLane.flushWriter);
  });

  it("shares the cron database pool with the fleet lane rather than doubling it", async () => {
    const hold = createHold();
    const fleet = await occupyGate(
      fleetIngestLane.pooledQueryGate,
      OVERSUBSCRIPTION,
      hold.held,
    );
    const push = await occupyGate(
      pushIngestLane.pooledQueryGate,
      OVERSUBSCRIPTION,
      hold.held,
    );

    expect(push.peak).toBeGreaterThan(0);
    expect(fleet.peak + push.peak).toBeLessThanOrEqual(CRON_DATABASE_POOL_MAX);
  });

  it("shares the flush database connections with the fleet lane", async () => {
    const hold = createHold();
    const fleet = await occupyWriter(
      fleetIngestLane.flushWriter,
      FLUSH_WRITER_CONNECTIONS,
      hold.held,
    );
    const push = await occupyWriter(
      pushIngestLane.flushWriter,
      FLUSH_WRITER_CONNECTIONS,
      hold.held,
    );

    expect(push.peak).toBeGreaterThan(0);
    expect(fleet.peak + push.peak).toBeLessThanOrEqual(FLUSH_WRITER_CONNECTIONS);
  });
});
