import { describe, expect, it, vi } from "vitest";
import type { AbandonedPushChannelResidue } from "@/utils/push-notifications/deregister-account-channels";

const DELETED_USER = "A";
const SETTLE_AFTER_ABORT_WINDOW_MS = 3600;
const RESIDUE_GRACE_MS = 2000;

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

interface DeferredDraft {
  promise: Promise<ResidueDraft>;
  resolve: (draft: ResidueDraft) => void;
}

const createDeferredDraft = (): DeferredDraft => {
  let capture: ((draft: ResidueDraft) => void) | null = null;
  const promise = new Promise<ResidueDraft>((resolve) => {
    capture = resolve;
  });

  if (capture === null) {
    throw new Error("Promise executor did not run synchronously");
  }

  return { promise, resolve: capture };
};

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
    "records the abandoned channel as residue without making the delete wait for it",
    async () => {
      const { abandonment, createDeleteUserSyncTeardown } = await loadTeardown();

      let slowWorkSettled = false;
      const pushChannelDraft = createDeferredDraft();

      const drafts: ResidueDraft[] = [];
      const teardown = createDeleteUserSyncTeardown(
        makeDependencies(
          (draft) => {
            drafts.push(draft);
            if (draft.kind === "push_channel") {
              pushChannelDraft.resolve(draft);
            }
          },
          () =>
            new Promise<number>((_resolve, reject) => {
              setTimeout(() => {
                slowWorkSettled = true;
                reject(abandonment());
              }, SETTLE_AFTER_ABORT_WINDOW_MS);
            }),
        ) as never,
      );

      await teardown(DELETED_USER);

      expect(slowWorkSettled).toBe(false);
      expect(drafts.some((draft) => draft.kind === "push_channel")).toBe(false);

      const recorded = await Promise.race([
        pushChannelDraft.promise,
        new Promise<"no push_channel residue was recorded">((resolve) => {
          setTimeout(() => {
            resolve("no push_channel residue was recorded");
          }, SETTLE_AFTER_ABORT_WINDOW_MS + RESIDUE_GRACE_MS);
        }),
      ]);

      expect(recorded).toMatchObject({
        kind: "push_channel",
        provider: "google",
        providerChannelId: "google-A-1",
        providerResourceId: "resource-A-1",
        userId: DELETED_USER,
      });
    },
    20_000,
  );
});
