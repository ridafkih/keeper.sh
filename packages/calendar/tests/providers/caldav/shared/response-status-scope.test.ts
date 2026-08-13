import { describe, expect, it } from "vitest";
import {
  recordResponseStatus,
  runInResponseStatusScope,
} from "../../../../src/providers/caldav/shared/response-status-scope";

const deferred = <Value>(): {
  promise: Promise<Value>;
  resolve: (value: Value) => void;
} => {
  let resolve: (value: Value) => void = () => undefined;
  const promise = new Promise<Value>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
};

describe("response status scope", () => {
  it("ignores a status recorded with no scope active", () => {
    expect(() => recordResponseStatus(401)).not.toThrow();
  });

  it("does not leak a status recorded before the scope opened", async () => {
    recordResponseStatus(401);

    const status = await runInResponseStatusScope((getResponseStatus) =>
      Promise.resolve(getResponseStatus()));

    expect(status).toBeNull();
  });

  it("keeps concurrent scopes isolated from each other", async () => {
    const first = deferred<void>();
    const second = deferred<void>();

    const slowScope = runInResponseStatusScope(async (getResponseStatus) => {
      recordResponseStatus(207);
      first.resolve();
      await second.promise;
      return getResponseStatus();
    });

    const fastScope = runInResponseStatusScope(async (getResponseStatus) => {
      await first.promise;
      recordResponseStatus(401);
      second.resolve();
      return getResponseStatus();
    });

    expect(await Promise.all([slowScope, fastScope])).toEqual([207, 401]);
  });

  it("starts every repeated run of the same scope from a clean status", async () => {
    const statuses: (number | null)[] = [];

    for (let run = 0; run < 3; run++) {
      await runInResponseStatusScope(async (getResponseStatus) => {
        statuses.push(getResponseStatus());
        recordResponseStatus(401);
        await Promise.resolve();
      });
    }

    expect(statuses).toEqual([null, null, null]);
  });

  it("shadows the outer scope from a nested scope without corrupting it", async () => {
    const outerStatus = await runInResponseStatusScope(async (getOuterStatus) => {
      recordResponseStatus(401);
      await runInResponseStatusScope(async (getInnerStatus) => {
        expect(getInnerStatus()).toBeNull();
        recordResponseStatus(207);
        await Promise.resolve();
      });
      return getOuterStatus();
    });

    expect(outerStatus).toBe(401);
  });

  /*
   * Requests inside one scope are last-write-wins: tsdav fans out
   * supported-report-set probes with Promise.all, so a sibling that finishes
   * later overwrites an earlier 401. That is only safe while no fanned-out
   * request can be the reason the operation throws.
   */
  it("lets a later sibling request overwrite an earlier 401 in the same scope", async () => {
    const status = await runInResponseStatusScope(async (getResponseStatus) => {
      const unauthorized = (async (): Promise<void> => {
        recordResponseStatus(null);
        await Promise.resolve();
        recordResponseStatus(401);
      })();

      const succeeded = (async (): Promise<void> => {
        await Promise.resolve();
        recordResponseStatus(null);
        await Promise.resolve();
        await Promise.resolve();
        recordResponseStatus(207);
      })();

      await Promise.all([unauthorized, succeeded]);
      return getResponseStatus();
    });

    expect(status).toBe(207);
  });
});
