import { afterEach, describe, expect, it } from "vitest";
import { startIngestLane } from "../../src/ingest/ingest-lane";
import type { IngestLane, IngestLaneOptions } from "../../src/ingest/ingest-lane";

interface Claim {
  calendarId: string;
}

interface Deferred {
  promise: Promise<null>;
  resolve: () => void;
}

const defer = (): Deferred => {
  const { promise, resolve } = Promise.withResolvers<null>();
  return { promise, resolve: () => resolve(null) };
};

const tick = (delayMs = 5): Promise<null> => new Promise((resolve) => {
  setTimeout(() => resolve(null), delayMs);
});

const waitFor = async (condition: () => boolean, timeoutMs = 2000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error("condition never held");
    }
    await tick(2);
  }
};

const claimsFrom = (prefix: string, count: number): Claim[] =>
  Array.from({ length: count }, (_unused, index) => ({ calendarId: `${prefix}-${index}` }));

const running: IngestLane<Claim>[] = [];

const start = (options: Partial<IngestLaneOptions<Claim>> & Pick<IngestLaneOptions<Claim>, "claim" | "runRound">): IngestLane<Claim> => {
  const lane = startIngestLane<Claim>({
    batchSize: 10,
    capacity: 10,
    idleMs: 10,
    onError: () => null,
    ...options,
  });
  running.push(lane);
  return lane;
};

afterEach(async () => {
  await Promise.all(running.splice(0).map((lane) => lane.stop()));
});

describe("startIngestLane", () => {
  it("never claims more than the free capacity", async () => {
    const limits: number[] = [];
    const rounds: Deferred[] = [];
    const release = { all: false };
    let remaining = 25;
    const lane = start({
      batchSize: 4,
      capacity: 6,
      claim: (limit) => {
        limits.push(limit);
        const count = Math.min(limit, remaining);
        remaining -= count;
        return Promise.resolve(claimsFrom("calendar", count));
      },
      runRound: () => {
        if (release.all) {
          return Promise.resolve();
        }
        const round = defer();
        rounds.push(round);
        return round.promise;
      },
    });

    await waitFor(() => lane.inFlight() === 6);
    await tick(30);

    expect(lane.inFlight()).toBe(6);
    expect(limits.every((limit) => limit <= 4)).toBe(true);
    expect(limits.slice(0, 2)).toEqual([4, 2]);

    rounds[0]?.resolve();
    await waitFor(() => limits.length === 3);
    expect(limits[2]).toBe(4);

    release.all = true;
    for (const round of rounds) {
      round.resolve();
    }
  });

  it("idles when nothing is due and claims again after the idle period", async () => {
    let calls = 0;
    start({
      claim: () => {
        calls += 1;
        return Promise.resolve([]);
      },
      idleMs: 20,
      runRound: () => Promise.resolve(),
    });

    await tick(70);

    expect(calls).toBeGreaterThanOrEqual(2);
    expect(calls).toBeLessThanOrEqual(5);
  });

  it("keeps claiming after a claim fails and reports the failure", async () => {
    const errors: string[] = [];
    let calls = 0;
    start({
      claim: () => {
        calls += 1;
        if (calls === 1) {
          return Promise.reject(new Error("database restarting"));
        }
        return Promise.resolve([]);
      },
      onError: (_error, phase) => {
        errors.push(phase);
      },
      runRound: () => Promise.resolve(),
    });

    await waitFor(() => calls >= 3);

    expect(errors).toEqual(["claim"]);
  });

  it("frees capacity and reports a round that throws", async () => {
    const errors: string[] = [];
    let served = 0;
    const lane = start({
      capacity: 2,
      claim: (limit) => {
        if (served >= 4) {
          return Promise.resolve([]);
        }
        served += limit;
        return Promise.resolve(claimsFrom("calendar", limit));
      },
      onError: (_error, phase) => {
        errors.push(phase);
      },
      runRound: () => Promise.reject(new Error("ingest blew up")),
    });

    await waitFor(() => served >= 4 && lane.inFlight() === 0);

    expect(errors.filter((phase) => phase === "round").length).toBeGreaterThanOrEqual(2);
  });

  it("waits for in-flight rounds on stop and starts nothing new", async () => {
    const round = defer();
    let claims = 0;
    const lane = start({
      claim: () => {
        claims += 1;
        if (claims === 1) {
          return Promise.resolve(claimsFrom("calendar", 3));
        }
        return Promise.resolve([]);
      },
      runRound: () => round.promise,
    });
    await waitFor(() => lane.inFlight() === 3);

    const progress = { stopped: false };
    const stopping = (async (): Promise<void> => {
      await lane.stop();
      progress.stopped = true;
    })();
    await tick(20);
    expect(progress.stopped).toBe(false);
    expect(lane.pendingClaims().map(({ calendarId }) => calendarId)).toEqual([
      "calendar-0",
      "calendar-1",
      "calendar-2",
    ]);

    round.resolve();
    await stopping;
    const claimsAtStop = claims;
    await tick(30);

    expect(lane.pendingClaims()).toEqual([]);
    expect(claims).toBe(claimsAtStop);
  });
});
