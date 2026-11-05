import { describe, expect, test } from "vitest";
import { createSingleFlight } from "../src/single-flight";

const neverRetained = { retain: () => false };

const settledLater = <Value>(): {
  promise: Promise<Value>;
  resolve: (value: Value) => void;
  reject: (failure: unknown) => void;
} => Promise.withResolvers<Value>();

describe("a coalescing slot is never a place a key can die", () => {
  test("CONF-L4: a rejecting body reaches every follower registered before it settled", async () => {
    const flights = createSingleFlight<string>(neverRetained);
    const leader = settledLater<string>();

    const first = flights.run("key", () => leader.promise);
    const second = flights.run("key", () => leader.promise);
    leader.reject(new Error("the leader failed"));
    const settled = await Promise.allSettled([first, second]);

    expect(settled.map((entry) => entry.status)).toEqual(["rejected", "rejected"]);
  });

  test("CONF-L7: a rejecting body releases its key, so the next caller starts a fresh flight", async () => {
    const flights = createSingleFlight<string>(neverRetained);
    let bodies = 0;
    const failing = (): Promise<string> => {
      bodies += 1;
      return Promise.reject(new Error("the leader failed"));
    };

    await Promise.allSettled([flights.run("key", failing)]);
    const afterwards = await flights.run("key", () => Promise.resolve("healthy"));

    expect(afterwards).toBe("healthy");
    expect(bodies).toBe(1);
    expect(flights.inFlightKeys()).toBe(0);
  });

  test("CONF-L2: an abandoned key is not joined by the caller that follows it", async () => {
    const flights = createSingleFlight<string>(neverRetained);
    const wedged = settledLater<string>();

    const abandoned = flights.run("key", () => wedged.promise);
    flights.abandon("key");
    const afterwards = await flights.run("key", () => Promise.resolve("fresh"));

    expect(afterwards).toBe("fresh");
    expect(flights.inFlightKeys()).toBe(0);
    wedged.resolve("the abandoned leader eventually answered");
    await expect(abandoned).resolves.toBe("the abandoned leader eventually answered");
  });

  test("CONF-L6: two keys in flight at once do not evict each other", async () => {
    const flights = createSingleFlight<string>(neverRetained);
    const alpha = settledLater<string>();
    const bravo = settledLater<string>();

    const first = flights.run("alpha", () => alpha.promise);
    const second = flights.run("bravo", () => bravo.promise);
    expect(flights.inFlightKeys()).toBe(2);
    alpha.resolve("alpha");
    bravo.resolve("bravo");

    expect(await Promise.all([first, second])).toEqual(["alpha", "bravo"]);
    expect(flights.inFlightKeys()).toBe(0);
  });
});
