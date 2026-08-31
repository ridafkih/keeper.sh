import { describe, expect, test } from "vitest";
import {
  createGoogleTokenRefresher,
  fetchUserInfo as fetchGoogleUserInfo,
} from "../../../src/core/oauth/google";
import {
  createMicrosoftTokenRefresher,
  fetchUserInfo as fetchMicrosoftUserInfo,
} from "../../../src/core/oauth/microsoft";

type CallableWithSignal = (
  token: string,
  signal?: AbortSignal,
) => Promise<unknown>;

const CALLER_BUDGET_MS = 50;
const PATIENCE_MS = 800;
const CREDENTIALS = { clientId: "client-id", clientSecret: "client-secret" };

const blackHoleFetch = (observedSignals: (AbortSignal | null)[]) =>
  (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const signal = init?.signal ?? null;
    observedSignals.push(signal);

    return new Promise<Response>((_resolve, reject) => {
      if (!signal) {
        return;
      }

      if (signal.aborted) {
        reject(signal.reason);
        return;
      }

      signal.addEventListener("abort", () => {
        reject(signal.reason);
      });
    });
  };

const settleOrRemainPending = async (
  work: Promise<unknown>,
): Promise<"rejected" | "resolved" | "pending"> => {
  const patience = new Promise<"pending">((resolve) => {
    setTimeout(() => {
      resolve("pending");
    }, PATIENCE_MS);
  });

  return await Promise.race([
    work.then(() => "resolved" as const, () => "rejected" as const),
    patience,
  ]);
};

const expectCallerSignalToAbortTheRequest = async (
  call: CallableWithSignal,
): Promise<void> => {
  const observedSignals: (AbortSignal | null)[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = blackHoleFetch(observedSignals) as typeof globalThis.fetch;

  try {
    const started = Date.now();
    const outcome = await settleOrRemainPending(
      call("token-value", AbortSignal.timeout(CALLER_BUDGET_MS)),
    );

    expect(outcome).toBe("rejected");
    expect(Date.now() - started).toBeLessThan(PATIENCE_MS);
    expect(observedSignals.length).toBeGreaterThan(0);
  }
  finally {
    globalThis.fetch = originalFetch;
  }
};

const expectDefaultTimeoutWithoutACallerSignal = async (
  call: CallableWithSignal,
): Promise<void> => {
  const observedSignals: (AbortSignal | null)[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = blackHoleFetch(observedSignals) as typeof globalThis.fetch;

  try {
    const work = call("token-value");
    const outcome = await settleOrRemainPending(work);

    expect(outcome).toBe("pending");
    expect(observedSignals.length).toBeGreaterThan(0);
    expect(observedSignals.every((signal) => signal instanceof AbortSignal)).toBe(true);
    expect(observedSignals.every((signal) => signal?.aborted === false)).toBe(true);

    const abandoned = work.then(
      () => undefined,
      () => undefined,
    );

    expect(abandoned).toBeInstanceOf(Promise);
  }
  finally {
    globalThis.fetch = originalFetch;
  }
};

describe("userinfo and refresh honour a caller supplied abort signal", () => {
  test("google fetchUserInfo aborts when the caller signal fires", async () => {
    await expectCallerSignalToAbortTheRequest(
      fetchGoogleUserInfo as unknown as CallableWithSignal,
    );
  });

  test("google token refresher aborts when the caller signal fires", async () => {
    await expectCallerSignalToAbortTheRequest(
      createGoogleTokenRefresher(CREDENTIALS) as unknown as CallableWithSignal,
    );
  });

  test("microsoft fetchUserInfo aborts when the caller signal fires", async () => {
    await expectCallerSignalToAbortTheRequest(
      fetchMicrosoftUserInfo as unknown as CallableWithSignal,
    );
  });

  test("microsoft token refresher aborts when the caller signal fires", async () => {
    await expectCallerSignalToAbortTheRequest(
      createMicrosoftTokenRefresher(CREDENTIALS) as unknown as CallableWithSignal,
    );
  });

  test("google fetchUserInfo keeps its own timeout when no caller signal is given", async () => {
    await expectDefaultTimeoutWithoutACallerSignal(
      fetchGoogleUserInfo as unknown as CallableWithSignal,
    );
  });

  test("google token refresher keeps its own timeout when no caller signal is given", async () => {
    await expectDefaultTimeoutWithoutACallerSignal(
      createGoogleTokenRefresher(CREDENTIALS) as unknown as CallableWithSignal,
    );
  });

  test("microsoft fetchUserInfo keeps its own timeout when no caller signal is given", async () => {
    await expectDefaultTimeoutWithoutACallerSignal(
      fetchMicrosoftUserInfo as unknown as CallableWithSignal,
    );
  });

  test("microsoft token refresher keeps its own timeout when no caller signal is given", async () => {
    await expectDefaultTimeoutWithoutACallerSignal(
      createMicrosoftTokenRefresher(CREDENTIALS) as unknown as CallableWithSignal,
    );
  });
});
