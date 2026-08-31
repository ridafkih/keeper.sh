import { describe, expect, it } from "vitest";
import type { DeregisterPushChannelsDependencies } from "@/utils/push-notifications/deregister-account-channels";
import {
  DEREGISTRATION_FAILED_SLUG,
  runDeregisterPushChannelsOutcome,
} from "@/utils/push-notifications/deregister-account-channels";

const DISCONNECT_CONCURRENCY = 8;
const LISTING_FAILURE = "db down: ECONNRESET";

interface RecordedError {
  error: unknown;
  slug: string;
}

const makeDependencies = (): {
  dependencies: DeregisterPushChannelsDependencies;
  recorded: RecordedError[];
} => {
  const recorded: RecordedError[] = [];

  return {
    dependencies: {
      createRegistrarContext: () =>
        Promise.reject(new Error("no channel should ever be dialled here")),
      listLiveChannels: () => Promise.reject(new Error(LISTING_FAILURE)),
      observe: () => undefined,
      recordError: (error: unknown, slug: string) => {
        recorded.push({ error, slug });
      },
      resolveRegistrar: () => null,
      webhookConfigured: true,
    },
    recorded,
  };
};

const settle = async <Value>(work: Promise<Value>) =>
  await work.then(
    (value) => ({ status: "fulfilled" as const, value }),
    (error: unknown) => ({ error, status: "rejected" as const }),
  );

const describeError = (error: unknown): string =>
  error instanceof Error
    ? `${error.message} ${describeError(error.cause)}`
    : String(error ?? "");

describe("a delete-user push channel listing that fails is loud", () => {
  it("rejects rather than reporting zero channels deregistered", async () => {
    const { dependencies, recorded } = makeDependencies();

    const outcome = await settle(runDeregisterPushChannelsOutcome(
      "user-1",
      dependencies,
      null,
      DISCONNECT_CONCURRENCY,
      true,
    ));

    expect(outcome.status).toBe("rejected");
    if (outcome.status === "rejected") {
      expect(describeError(outcome.error)).toContain(LISTING_FAILURE);
    }

    expect(recorded.map((entry) => entry.slug)).toContain(DEREGISTRATION_FAILED_SLUG);
  });

  it("still fails open for the account and calendar scoped paths", async () => {
    const { dependencies, recorded } = makeDependencies();

    await expect(runDeregisterPushChannelsOutcome(
      "user-1",
      dependencies,
      null,
      DISCONNECT_CONCURRENCY,
      false,
    )).resolves.toEqual({
      abandonments: [],
      deregisteredCount: 0,
      stoppedProviderChannelIds: [],
    });

    expect(recorded.map((entry) => entry.slug)).toContain(DEREGISTRATION_FAILED_SLUG);
  });
});
