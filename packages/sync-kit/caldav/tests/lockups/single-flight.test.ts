import { describe, expect, test } from "vitest";
import { createSingleFlight } from "../../src/client/single-flight";

const neverAborts = (): AbortSignal => new AbortController().signal;

const collection = "/calendars/alice/personal/";

describe("coalescing one collection's REPORT must not strand anybody", () => {
  test("DAV-L11: a failing leader rejects every follower rather than leaving them pending", async () => {
    const flights = createSingleFlight<string>();
    const leading = Promise.withResolvers<string>();
    const leader = flights.run(collection, () => leading.promise, neverAborts());
    const followers = [
      flights.run(collection, () => Promise.resolve("never led"), neverAborts()),
      flights.run(collection, () => Promise.resolve("never led"), neverAborts()),
    ];
    leading.reject(new Error("the REPORT failed for the leader"));

    await expect(leader).rejects.toThrow("the REPORT failed for the leader");
    const settled = await Promise.allSettled(followers);

    expect(settled.map((entry) => entry.status)).toEqual(["rejected", "rejected"]);
    expect(flights.inFlightKeys()).toEqual([]);
  }, 30_000);

  test("DAV-L12: two concurrent calls for the same collection coalesce and neither deadlocks", async () => {
    const flights = createSingleFlight<string>();
    let leads = 0;
    const lead = (): Promise<string> => {
      leads += 1;
      return Promise.resolve("one report");
    };

    const answered = await Promise.all([
      flights.run(collection, lead, neverAborts()),
      flights.run(collection, lead, neverAborts()),
    ]);

    expect(answered).toEqual(["one report", "one report"]);
    expect(leads).toBe(1);
    expect(flights.inFlightKeys()).toEqual([]);
  }, 30_000);

  test("DAV-L13: an aborted follower does not cancel the leader's work for the others", async () => {
    const flights = createSingleFlight<string>();
    const leading = Promise.withResolvers<string>();
    let leaderSawAbort = false;
    const leader = flights.run(
      collection,
      (signal) => {
        signal.addEventListener("abort", () => {
          leaderSawAbort = true;
        });
        return leading.promise;
      },
      neverAborts(),
    );
    const departing = new AbortController();
    const middle = flights.run(collection, () => leading.promise, departing.signal);
    const last = flights.run(collection, () => leading.promise, neverAborts());
    departing.abort();
    leading.resolve("the leader still finished");

    await expect(middle).rejects.toThrow();
    expect(await leader).toBe("the leader still finished");
    expect(await last).toBe("the leader still finished");
    expect(leaderSawAbort).toBe(false);
  }, 30_000);
});
