import { describe, expect, it } from "vitest";
import {
  recordRequest,
  runInRequestScope,
} from "../../../../src/providers/caldav/shared/response-status-scope";

const signal = (): { open: () => void; promise: Promise<boolean> } => {
  const { promise, resolve } = Promise.withResolvers<boolean>();
  return {
    open: () => {
      resolve(true);
    },
    promise,
  };
};

const respond = (status: number): Promise<Response> =>
  Promise.resolve(new Response(null, { status }));

const request = (status: number): Promise<Response> => recordRequest(() => respond(status));

const failingRequest = (error: Error): Promise<Response> =>
  recordRequest(() => {
    throw error;
  });

describe("CalDAV request scope", () => {
  it("ignores a request performed with no scope active", async () => {
    const response = await request(401);

    expect(response.status).toBe(401);
  });

  it("does not leak a request performed before the scope opened", async () => {
    await request(401);

    const unauthorized = await runInRequestScope((requests) =>
      Promise.resolve(requests.hasUnrefutedUnauthorized()));

    expect(unauthorized).toBe(false);
  });

  it("keeps concurrent scopes isolated from each other", async () => {
    const first = signal();
    const second = signal();

    const healthyScope = runInRequestScope(async (requests) => {
      await request(207);
      first.open();
      await second.promise;
      return requests.hasUnrefutedUnauthorized();
    });

    const deniedScope = runInRequestScope(async (requests) => {
      await first.promise;
      await request(401);
      second.open();
      return requests.hasUnrefutedUnauthorized();
    });

    expect(await Promise.all([healthyScope, deniedScope])).toEqual([false, true]);
  });

  it("starts every repeated run of the same scope from a clean ledger", async () => {
    const verdicts: boolean[] = [];

    for (let run = 0; run < 3; run++) {
      await runInRequestScope(async (requests) => {
        verdicts.push(requests.hasUnrefutedUnauthorized());
        await request(401);
      });
    }

    expect(verdicts).toEqual([false, false, false]);
  });

  it("shadows the outer scope from a nested scope without corrupting it", async () => {
    const outerUnauthorized = await runInRequestScope(async (requests) => {
      await request(401);
      await runInRequestScope(async (innerRequests) => {
        expect(innerRequests.hasUnrefutedUnauthorized()).toBe(false);
        await request(207);
      });
      return requests.hasUnrefutedUnauthorized();
    });

    expect(outerUnauthorized).toBe(true);
  });

  it("treats a 401 as unrefuted when every accepted request settled before it started", async () => {
    const unauthorized = await runInRequestScope(async (requests) => {
      await request(207);
      await request(401);
      return requests.hasUnrefutedUnauthorized();
    });

    expect(unauthorized).toBe(true);
  });

  it("lets a request accepted after a 401 refute it", async () => {
    const unauthorized = await runInRequestScope(async (requests) => {
      await request(401);
      await request(207);
      return requests.hasUnrefutedUnauthorized();
    });

    expect(unauthorized).toBe(false);
  });

  it("lets a concurrently accepted sibling refute a 401 whichever settles last", async () => {
    const settleAfter = async (ticks: number, status: number): Promise<Response> => {
      for (let tick = 0; tick < ticks; tick += 1) {
        await Promise.resolve();
      }
      return respond(status);
    };

    const verdicts = await Promise.all(
      [
        { acceptedTicks: 4, deniedTicks: 0 },
        { acceptedTicks: 0, deniedTicks: 4 },
      ].map(({ acceptedTicks, deniedTicks }) =>
        runInRequestScope(async (requests) => {
          await Promise.all([
            recordRequest(() => settleAfter(deniedTicks, 401)),
            recordRequest(() => settleAfter(acceptedTicks, 207)),
          ]);

          return requests.hasUnrefutedUnauthorized();
        })),
    );

    expect(verdicts).toEqual([false, false]);
  });

  it("does not let an unsettled request refute a 401", async () => {
    const release = Promise.withResolvers<Response>();

    const unauthorized = await runInRequestScope(async (requests) => {
      const pending = recordRequest(() => release.promise);
      await request(401);
      const verdict = requests.hasUnrefutedUnauthorized();
      release.resolve(new Response(null, { status: 207 }));
      await pending;
      return verdict;
    });

    expect(unauthorized).toBe(true);
  });

  it("recognises the error a request that never produced a response propagated", async () => {
    const reason = new Error("socket hang up");

    const propagated = await runInRequestScope(async (requests) => {
      await failingRequest(reason).catch(() => null);
      return requests.isPropagatedTransportFailure(reason);
    });

    expect(propagated).toBe(true);
  });

  it("recognises a transport failure carried as the cause of a wrapping error", async () => {
    const reason = new Error("socket hang up");

    const propagated = await runInRequestScope(async (requests) => {
      await failingRequest(reason).catch(() => null);
      return requests.isPropagatedTransportFailure(
        new Error("Collection query failed", { cause: new Error("wrapped", { cause: reason }) }),
      );
    });

    expect(propagated).toBe(true);
  });

  it("does not treat an unrelated error as a transport failure the caller recovered from", async () => {
    const propagated = await runInRequestScope(async (requests) => {
      await failingRequest(new Error("socket hang up")).catch(() => null);
      return requests.isPropagatedTransportFailure(new Error("Invalid credentials"));
    });

    expect(propagated).toBe(false);
  });

  it("reports no transport failure when every request produced a response", async () => {
    const propagated = await runInRequestScope(async (requests) => {
      await request(401);
      return requests.isPropagatedTransportFailure(new Error("Invalid credentials"));
    });

    expect(propagated).toBe(false);
  });
});
