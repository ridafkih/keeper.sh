import { afterEach, describe, expect, it, vi } from "vitest";
import type { TeardownResidueRecord } from "@keeper.sh/calendar";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";
const ENCRYPTION_KEY = "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=";
const HOUR_MS = 60 * 60 * 1000;
const DIAL_OBSERVATION_WINDOW_MS = 100;
const ABORT_OBSERVATION_WINDOW_MS = 500;

vi.mock("@/context", () => ({
  database: {},
  polarClient: null,
  webhookConfig: null,
}));

vi.mock("@/env", () => ({
  default: {
    ENCRYPTION_KEY,
    GOOGLE_CLIENT_ID: "google-client",
    GOOGLE_CLIENT_SECRET: "google-secret",
  },
}));

vi.mock("@/utils/logging", () => ({
  context: (run: () => Promise<unknown>) => run(),
  widelog: {
    append: () => null,
    count: () => null,
    error: () => null,
    errorFields: () => null,
    flush: () => null,
    max: () => null,
    min: () => null,
    set: () => null,
    setFields: () => null,
    time: {
      measure: <TResult>(_key: string, run: () => Promise<TResult>) => run(),
    },
  },
}));

interface DialedRequest {
  signal: AbortSignal | null;
  url: string;
}

type ResidueIdentityResolver = (
  record: TeardownResidueRecord,
  signal: AbortSignal,
) => Promise<string | null>;

const residueIdentityResolver = async (): Promise<ResidueIdentityResolver> => {
  const job: Record<string, unknown> = await import("../../src/jobs/reap-teardown-residue");
  const exported = job.resolveResidueProviderAccountId;

  if (typeof exported !== "function") {
    throw new TypeError(
      "services/cron/src/jobs/reap-teardown-residue.ts exports no resolveResidueProviderAccountId, so the reaper's residue identity resolution cannot be driven with a deadline signal",
    );
  }

  return exported as ResidueIdentityResolver;
};

const dialProviderThatNeverAnswers = (dialed: DialedRequest[]): void => {
  vi.stubGlobal("fetch", (input: Request | string | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const signal = init?.signal ?? null;
    dialed.push({ signal, url });

    return new Promise<Response>((_resolve, reject) => {
      if (signal === null) {
        return;
      }

      if (signal.aborted) {
        reject(new Error(`The provider call to ${url} was aborted`));
        return;
      }

      signal.addEventListener("abort", () => {
        reject(new Error(`The provider call to ${url} was aborted`));
      });
    });
  });
};

const settleWithin = (
  pending: Promise<unknown>,
  windowMs: number,
): Promise<"pending" | "rejected" | "resolved"> =>
  Promise.race([
    pending.then(
      () => "resolved" as const,
      () => "rejected" as const,
    ),
    new Promise<"pending">((resolve) => {
      setTimeout(() => {
        resolve("pending");
      }, windowMs);
    }),
  ]);

const residueWithCredentialExpiringAt = (expiresAt: Date): TeardownResidueRecord => ({
  accountEmail: "deleted@workspace.example",
  credential: {
    accessToken: "residue-access-token",
    expiresAt,
    refreshToken: "residue-refresh-token",
  },
  id: "9d5c1d2e-0d3a-4d4e-9b3f-6a0f0c2b1a55",
  kind: "oauth_grant",
  provider: "google",
  userId: "deleted-user",
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("residue identity resolution", () => {
  it("tears down the user info call when the repair deadline is abandoned", async () => {
    const resolve = await residueIdentityResolver();
    const dialed: DialedRequest[] = [];
    dialProviderThatNeverAnswers(dialed);

    const abandonment = new AbortController();
    const resolution = resolve(
      residueWithCredentialExpiringAt(new Date(Date.now() + 6 * HOUR_MS)),
      abandonment.signal,
    );

    expect(await settleWithin(resolution, DIAL_OBSERVATION_WINDOW_MS)).toBe("pending");
    expect(dialed.map((request) => request.url)).toEqual([GOOGLE_USERINFO_URL]);
    expect(dialed[0]?.signal).toBeInstanceOf(AbortSignal);

    abandonment.abort();

    expect(await settleWithin(resolution, ABORT_OBSERVATION_WINDOW_MS)).toBe("rejected");
  });

  it("tears down the credential refresh when the repair deadline is abandoned", async () => {
    const resolve = await residueIdentityResolver();
    const dialed: DialedRequest[] = [];
    dialProviderThatNeverAnswers(dialed);

    const abandonment = new AbortController();
    const resolution = resolve(
      residueWithCredentialExpiringAt(new Date(Date.now() - HOUR_MS)),
      abandonment.signal,
    );

    expect(await settleWithin(resolution, DIAL_OBSERVATION_WINDOW_MS)).toBe("pending");
    expect(dialed.map((request) => request.url)).toEqual([GOOGLE_TOKEN_URL]);
    expect(dialed[0]?.signal).toBeInstanceOf(AbortSignal);

    abandonment.abort();

    expect(await settleWithin(resolution, ABORT_OBSERVATION_WINDOW_MS)).toBe("rejected");
  });
});
