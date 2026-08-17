import { describe, expect, test } from "vitest";
import { createSingleFlight } from "../../src/client/single-flight";
import { createGoogleInternals } from "../../src/internals";
import { createHarness, marchWindow, operationContext, scopeOver } from "../support/harness";
import { foreignEvent, seedOf } from "../support/items";

const seeded = () => [
  foreignEvent({ uid: "shared", start: "2026-03-23T09:00:00.000Z", end: "2026-03-23T10:00:00.000Z" }),
];

const threeIdenticalListings = (harness: ReturnType<typeof createHarness>) => {
  const scope = scopeOver(marchWindow);
  return [1, 2, 3].map(() =>
    harness.provider.listChanges({ scope, resume: null }, operationContext(harness.environment)),
  );
};

describe("a coalesced leader's failure reaches every follower", () => {
  test("GOOG-L4: a leader that throws rejects all three followers and empties the map", async () => {
    const harness = createHarness();
    harness.fake.seedFromProvider(seedOf(seeded()));
    harness.environment.transport.answerWith({ kind: "throw", times: 1 });

    const settled = await Promise.allSettled(threeIdenticalListings(harness));

    expect(settled.map((entry) => entry.status)).toEqual(["fulfilled", "fulfilled", "fulfilled"]);
    expect(
      settled.flatMap((entry) => {
        if (entry.status !== "fulfilled") {
          return [];
        }
        return [entry.value.ok];
      }),
    ).toEqual([false, false, false]);
  });

  test("GOOG-L4: the next listing after a failed leader is not poisoned by it", async () => {
    const harness = createHarness();
    harness.fake.seedFromProvider(seedOf(seeded()));
    harness.environment.transport.answerWith({ kind: "throw", times: 1 });
    await Promise.allSettled(threeIdenticalListings(harness));

    const afterwards = await harness.provider.listChanges(
      { scope: scopeOver(marchWindow), resume: null },
      operationContext(harness.environment),
    );

    expect(afterwards.ok).toBe(true);
  });

  test("GOOG-L4: three coalesced callers reach the transport once", async () => {
    const harness = createHarness();
    harness.fake.seedFromProvider(seedOf(seeded()));

    await Promise.all(threeIdenticalListings(harness));

    expect(harness.fake.listCallCount()).toBe(1);
  });

  test("GOOG-L4: a caller that gives up early does not cancel the caller that still has budget", async () => {
    const flights = createSingleFlight<string>();
    const impatient = new AbortController();
    const patient = new AbortController();
    const shared = Promise.withResolvers<string>();
    const leader: { signal: AbortSignal | null } = { signal: null };

    const first = flights.run(
      "one-key",
      (signal) => {
        leader.signal = signal;
        return shared.promise;
      },
      impatient.signal,
    );
    const second = flights.run(
      "one-key",
      () => Promise.reject(new Error("a second leader was started for one key")),
      patient.signal,
    );
    impatient.abort();
    shared.resolve("the answer the patient caller waited for");

    await expect(second).resolves.toBe("the answer the patient caller waited for");
    await expect(first).resolves.toBe("the answer the patient caller waited for");
    expect(leader.signal?.aborted).toBe(false);
  }, 30_000);

  test("GOOG-L4: the shared request is cancelled only once every caller has given up", async () => {
    const flights = createSingleFlight<string>();
    const first = new AbortController();
    const second = new AbortController();
    const shared = Promise.withResolvers<string>();
    const leader: { signal: AbortSignal | null } = { signal: null };

    const lead = (signal: AbortSignal): Promise<string> => {
      leader.signal = signal;
      return shared.promise;
    };
    const joined = [
      flights.run("one-key", lead, first.signal),
      flights.run("one-key", lead, second.signal),
    ];
    await Promise.resolve();
    first.abort();
    expect(leader.signal?.aborted).toBe(false);
    second.abort();

    expect(leader.signal?.aborted).toBe(true);
    expect(flights.inFlightKeys()).toEqual([]);
    shared.resolve("late");
    await Promise.all(joined);
  }, 30_000);

  test("GOOG-L4: a key abandoned by every caller is released, never left registered", async () => {
    const harness = createHarness();
    harness.environment.transport.stall();
    const internals = createGoogleInternals(harness.dependencies);

    await internals.provider.listChanges(
      { scope: scopeOver(marchWindow), resume: null },
      operationContext(harness.environment, { deadlineMs: 5 }),
    );

    expect(internals.inFlightKeys()).toEqual([]);
  }, 30_000);

  test("GOOG-L4: coalesced callers do not share one diagnostics object", async () => {
    const harness = createHarness();
    harness.fake.seedFromProvider(seedOf(seeded()));

    const [first, second] = await Promise.all(threeIdenticalListings(harness));

    if (!first?.ok || !second?.ok) {
      throw new Error("a coalesced listing failed where it had to succeed");
    }
    expect(first.value.diagnostics).not.toBe(second.value.diagnostics);
  });
});
