import { describe, expect, it, vi } from "vitest";
import type { AbandonedPushChannelResidue } from "@/utils/push-notifications/deregister-account-channels";

const DELETED_USER = "A";

interface LoggedError {
  error: unknown;
  fields: Record<string, unknown>;
}

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
  const loggedErrors: LoggedError[] = [];

  vi.resetModules();
  vi.doMock("@/utils/logging", () => ({
    context: (run: () => unknown) => run(),
    destroy: () => Promise.resolve(),
    widelog: {
      error: (prefix: string, error: unknown) => {
        loggedErrors.push({ error, fields: { prefix } });
      },
      errorFields: (error: unknown, fields: Record<string, unknown>) => {
        loggedErrors.push({ error, fields });
      },
      set: () => undefined,
      setFields: () => undefined,
    },
  }));

  const { createDeleteUserSyncTeardown, PUSH_CHANNELS_TIMEOUT_MS } = await import(
    "@/utils/delete-user-teardown"
  );
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

  return { abandonment, createDeleteUserSyncTeardown, loggedErrors, PUSH_CHANNELS_TIMEOUT_MS };
};

const makeDependencies = (
  drafts: ResidueDraft[],
  deregisterPushChannels: (userId: string, signal: AbortSignal) => Promise<number>,
) => ({
  createQueue: () => ({
    getJob: () => Promise.resolve(undefined),
    remove: () => Promise.resolve(0),
  }),
  deregisterPushChannels,
  fetchImpl: () => Promise.reject(new Error("no network call is expected from teardown")),
  listCalendarIds: () => Promise.resolve([]),
  listOAuthGrantProviders: () => Promise.resolve([]),
  listPushChannels: () => Promise.resolve([]),
  redis: {
    del: () => Promise.resolve(1),
    exists: () => Promise.resolve(1),
    set: () => Promise.resolve("OK"),
  },
  residue: {
    record: (draft: ResidueDraft) => {
      drafts.push(draft);
      return Promise.resolve();
    },
  },
});

describe("a push_channels step that abandons channels only after its deadline aborts it", () => {
  it("records push_channel residue when the step rejects before the deadline", async () => {
    const { abandonment, createDeleteUserSyncTeardown } = await loadTeardown();
    const drafts: ResidueDraft[] = [];

    await createDeleteUserSyncTeardown(
      makeDependencies(drafts, () => Promise.reject(abandonment())) as never,
    )(DELETED_USER);

    expect(drafts.map((draft) => draft.kind)).toEqual(["push_channel"]);
  });

  it("records the same push_channel residue when the abandonment only surfaces after the abort", async () => {
    const { abandonment, createDeleteUserSyncTeardown, loggedErrors, PUSH_CHANNELS_TIMEOUT_MS } =
      await loadTeardown();
    const drafts: ResidueDraft[] = [];

    await createDeleteUserSyncTeardown(
      makeDependencies(
        drafts,
        (_userId, signal) =>
          new Promise<number>((_resolve, reject) => {
            signal.addEventListener("abort", () => {
              reject(abandonment());
            });
          }),
      ) as never,
    )(DELETED_USER);

    expect(drafts.map((draft) => draft.kind)).toEqual(["push_channel"]);
    expect(drafts[0]).toMatchObject({
      kind: "push_channel",
      provider: "google",
      providerChannelId: "google-A-1",
      providerResourceId: "resource-A-1",
      userId: DELETED_USER,
    });

    const messages = loggedErrors.map((entry) =>
      entry.error instanceof Error ? entry.error.message : String(entry.error),
    );

    expect(
      messages.some((message) =>
        message.includes(
          `Teardown step push_channels exceeded its ${PUSH_CHANNELS_TIMEOUT_MS}ms deadline`,
        ),
      ),
    ).toBe(true);
  });
});
