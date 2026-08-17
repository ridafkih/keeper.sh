import { describe, expect, test } from "vitest";
import { createSingleFlight } from "../../src/client/single-flight";

const neverAborts = (): AbortSignal => new AbortController().signal;

describe("a coalesced leader's failure reaches every follower", () => {
  test("MS-L16: a leader's failure rejects every follower and leaves none pending", async () => {
    const flights = createSingleFlight<string>();
    const leaderFailure = new Error("the leader failed for everyone");

    const joined = [1, 2, 3].map(() =>
      flights.run("one-scope", () => Promise.reject(leaderFailure), neverAborts()),
    );
    const settled = await Promise.allSettled(joined);

    expect(settled.map((entry) => entry.status)).toEqual(["rejected", "rejected", "rejected"]);
    expect(flights.inFlightKeys()).toEqual([]);
  }, 30_000);

  test("MS-L16: three coalesced callers run one leader between them", async () => {
    const flights = createSingleFlight<string>();
    let leaders = 0;

    const joined = [1, 2, 3].map(() =>
      flights.run(
        "one-scope",
        () => {
          leaders += 1;
          return Promise.resolve("one answer");
        },
        neverAborts(),
      ),
    );

    await expect(Promise.all(joined)).resolves.toEqual(["one answer", "one answer", "one answer"]);
    expect(leaders).toBe(1);
  }, 30_000);
});
