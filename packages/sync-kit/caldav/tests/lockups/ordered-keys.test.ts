import { describe, expect, test } from "vitest";
import { createCollectionSemaphore } from "../../src/client/semaphore";

const neverAborts = (): AbortSignal => new AbortController().signal;

const personal = "/calendars/alice/personal/";
const work = "/calendars/alice/work/";

describe("two writers holding two collections cannot invert their locks", () => {
  test("DAV-L14: two callers acquiring the same two collections in opposite request order do not deadlock", async () => {
    const permits = createCollectionSemaphore(1);
    const entered: string[] = [];
    const firstInside = Promise.withResolvers<null>();
    const release = Promise.withResolvers<null>();

    const forward = permits.withPermits([personal, work], neverAborts(), async () => {
      entered.push("forward");
      firstInside.resolve(null);
      await release.promise;
      return "forward";
    });
    await firstInside.promise;
    const backward = permits.withPermits([work, personal], neverAborts(), () => {
      entered.push("backward");
      return Promise.resolve("backward");
    });
    release.resolve(null);

    expect(await Promise.all([forward, backward])).toEqual(["forward", "backward"]);
    expect(entered).toEqual(["forward", "backward"]);
    expect(permits.held(personal)).toBe(0);
    expect(permits.held(work)).toBe(0);
  }, 30_000);

  test("DAV-L14: a repeated collection is acquired once, so a caller cannot wait on itself", async () => {
    const permits = createCollectionSemaphore(1);

    const answered = await permits.withPermits([personal, personal], neverAborts(), () =>
      Promise.resolve("entered once"),
    );

    expect(answered).toBe("entered once");
    expect(permits.peak(personal)).toBe(1);
  }, 30_000);
});
