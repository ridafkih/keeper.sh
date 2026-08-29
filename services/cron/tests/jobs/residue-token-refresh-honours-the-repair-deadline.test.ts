import { afterEach, describe, expect, it, vi } from "vitest";
import type { RegistrarContext, TeardownResidueRecord } from "@keeper.sh/calendar";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const ENCRYPTION_KEY = "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=";
const HOUR_MS = 60 * 60 * 1000;
const DIAL_OBSERVATION_WINDOW_MS = 100;
const ABORT_OBSERVATION_WINDOW_MS = 500;

vi.mock("@/context", () => ({
  database: {},
  polarClient: null,
  webhookConfig: {
    googleCallbackUrl: "https://hooks.keeper.example/webhooks/google",
    outlookCallbackUrl: "https://hooks.keeper.example/webhooks/outlook",
  },
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

type ResidueRegistrarContextBuilder = (
  record: TeardownResidueRecord,
  signal: AbortSignal,
) => Promise<RegistrarContext>;

const residueRegistrarContextBuilder = async (): Promise<ResidueRegistrarContextBuilder> => {
  const job: Record<string, unknown> = await import("../../src/jobs/reap-teardown-residue");
  const exported = job.createResidueRegistrarContext;

  if (typeof exported !== "function") {
    throw new TypeError(
      "services/cron/src/jobs/reap-teardown-residue.ts exports no createResidueRegistrarContext, so the push channel registrar context cannot be driven with a repair deadline signal",
    );
  }

  return exported as ResidueRegistrarContextBuilder;
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

const pushChannelResidueExpiringAt = (expiresAt: Date): TeardownResidueRecord => ({
  credential: {
    accessToken: "residue-access-token",
    expiresAt,
    refreshToken: "residue-refresh-token",
  },
  id: "1b0e2f4a-77c5-4a1e-8d20-4f7c5b3a9e01",
  kind: "push_channel",
  provider: "google",
  providerChannelId: "channel-to-stop",
  providerResourceId: "resource-behind-the-channel",
  userId: "deleted-user",
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("residue registrar context", () => {
  it("tears down the credential refresh when the repair deadline is abandoned", async () => {
    const createContext = await residueRegistrarContextBuilder();
    const dialed: DialedRequest[] = [];
    dialProviderThatNeverAnswers(dialed);

    const abandonment = new AbortController();
    const building = createContext(
      pushChannelResidueExpiringAt(new Date(Date.now() - HOUR_MS)),
      abandonment.signal,
    );

    expect(await settleWithin(building, DIAL_OBSERVATION_WINDOW_MS)).toBe("pending");
    expect(dialed.map((request) => request.url)).toEqual([GOOGLE_TOKEN_URL]);
    expect(dialed[0]?.signal).toBeInstanceOf(AbortSignal);

    abandonment.abort();

    expect(await settleWithin(building, ABORT_OBSERVATION_WINDOW_MS)).toBe("rejected");
    expect(dialed[0]?.signal?.aborted).toBe(true);
  });

  it("composes the repair deadline into the channel stop signal", async () => {
    const createContext = await residueRegistrarContextBuilder();
    const dialed: DialedRequest[] = [];
    dialProviderThatNeverAnswers(dialed);

    const abandonment = new AbortController();
    const context = await createContext(
      pushChannelResidueExpiringAt(new Date(Date.now() + 6 * HOUR_MS)),
      abandonment.signal,
    );

    expect(dialed).toEqual([]);
    expect(context.signal?.aborted).toBe(false);

    abandonment.abort();

    expect(context.signal?.aborted).toBe(true);
  });
});
