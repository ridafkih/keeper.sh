import { describe, expect, it, vi } from "vitest";
import type { AbandonedPushChannelResidue } from "@/utils/push-notifications/deregister-account-channels";

const DELETED_USER = "A";
const SETTLE_AFTER_ABORT_WINDOW_MS = 3600;

interface ResidueDraft {
  kind: string;
  provider?: string;
  providerChannelId?: string;
  providerResourceId?: string;
  userId: string;
}

vi.mock("@/context", () => ({
  database: {},
  env: { REDIS_URL: "redis://localhost:6379" },
  redis: { set: () => Promise.resolve("OK") },
  refreshLockStore: {
    release: () => Promise.resolve(),
    tryAcquire: () => Promise.resolve(true),
  },
  webhookConfig: null,
}));

const abandonedResidue = (): AbandonedPushChannelResidue => ({
  credential: {
    accessToken: "access-token-for-account-A",
    expiresAt: null,
    refreshToken: "refresh-token-for-account-A",
  },
  provider: "google",
  providerChannelId: "google-A-1",
  providerResourceId: "resource-A-1",
});

const loadTeardown = async () => {
  vi.resetModules();
  vi.doMock("@/utils/logging", () => ({
    context: (run: () => unknown) => run(),
    destroy: () => Promise.resolve(),
    widelog: {
      error: () => undefined,
      errorFields: () => undefined,
      set: () => undefined,
      setFields: () => undefined,
    },
  }));

  const { createDeleteUserSyncTeardown } = await import("@/utils/delete-user-teardown");
  const { AbandonedPushChannelError } = await import(
    "@/utils/push-notifications/deregister-account-channels"
  );

  const abandonment = (): AggregateError =>
    new AggregateError(
      [
        new AbandonedPushChannelError(
          "Push channel channel-A-1 (google channel google-A-1) was not confirmed stopped at the provider",
          abandonedResidue(),
          {},
        ),
      ],
      "1 push channel(s) for userId A were left running at their provider",
    );

  return { abandonment, createDeleteUserSyncTeardown };
};

const makeDependencies = (
  onDraft: (draft: ResidueDraft) => void,
  deregisterPushChannels: (userId: string, signal: AbortSignal) => Promise<number>,
) => ({
  createQueue: () => ({
    getJob: () => Promise.resolve(undefined),
    remove: () => Promise.resolve(0),
  }),
  deregisterPushChannels,
  fetchImpl: () => Promise.reject(new Error("no network call is expected from teardown")),
  listCalendarIds: () => Promise.resolve([]),
  listOAuthCredentials: () =>
    Promise.resolve([
      {
        accessToken: "access-token-for-account-A",
        accountId: "account-A",
        email: "deleted@example.com",
        provider: "google",
        refreshToken: "refresh-token-for-account-A",
        userId: DELETED_USER,
      },
    ]),
  redis: {
    del: () => Promise.resolve(1),
    exists: () => Promise.resolve(1),
    set: () => Promise.resolve("OK"),
  },
  residue: {
    record: (draft: ResidueDraft) => {
      onDraft(draft);
      return Promise.resolve();
    },
  },
});

describe("push channel work that settles after the abort window", () => {
  it(
    "makes the abandoned channel durable before the grant residue",
    async () => {
      const { abandonment, createDeleteUserSyncTeardown } = await loadTeardown();

      const pushChannelWorkEvents: string[] = [];

      const drafts: ResidueDraft[] = [];
      const teardown = createDeleteUserSyncTeardown(
        makeDependencies(
          (draft) => {
            drafts.push(draft);
          },
          (_userId: string, signal: AbortSignal) =>
            new Promise<number>((_resolve, reject) => {
              signal.addEventListener("abort", () => {
                pushChannelWorkEvents.push("aborted");
              });
              setTimeout(() => {
                pushChannelWorkEvents.push("settled");
                reject(abandonment());
              }, SETTLE_AFTER_ABORT_WINDOW_MS);
            }),
        ) as never,
      );

      await teardown(DELETED_USER);

      expect(drafts.map((draft) => draft.kind)).toEqual(["push_channel", "oauth_grant"]);

      expect(drafts[0]).toMatchObject({
        kind: "push_channel",
        provider: "google",
        providerChannelId: "google-A-1",
        providerResourceId: "resource-A-1",
        userId: DELETED_USER,
      });

      expect(pushChannelWorkEvents).toEqual(["aborted", "settled"]);
    },
    20_000,
  );
});
