import { describe, expect, it, vi } from "vitest";
import type { TeardownPushChannel } from "@/utils/push-notifications/deregister-account-channels";

vi.mock("widelogger", () => ({
  widelog: {
    error: () => undefined,
    errorFields: () => undefined,
    errors: () => undefined,
    flush: () => undefined,
    set: () => undefined,
    setFields: () => undefined,
  },
  widelogger: () => ({
    context: (run: () => unknown) => run(),
    destroy: () => Promise.resolve(),
  }),
}));

const DELETED_USER = "user-1";
const PUSH_CHANNELS_STEP = "push_channels";
const BLOCKING_ERROR_NAME = "TeardownBlockedError";
const CHANNEL_COUNT = 10;
const CONCURRENCY_WAIT_MS = 750;

interface ResidueDraft {
  kind: string;
  providerChannelId?: string;
  userId: string;
}

interface RecordGate {
  peakInFlight: () => number;
  recorded: () => ResidueDraft[];
  release: () => void;
  store: {
    clear: (residueId: string) => Promise<void>;
    deleteForUser: (userId: string, kind: string) => Promise<number>;
    list: () => Promise<ResidueDraft[]>;
    purgeOrphaned: () => Promise<string[]>;
    record: (draft: ResidueDraft) => Promise<void>;
  };
}

const makeRecordGate = (
  settle: (draft: ResidueDraft) => { reject: Error } | { resolve: true },
): RecordGate => {
  const recorded: ResidueDraft[] = [];
  const pending: (() => void)[] = [];
  const state = { inFlight: 0, peak: 0, released: false };

  const finish = (draft: ResidueDraft, resolve: () => void, reject: (error: Error) => void) => {
    state.inFlight -= 1;

    const outcome = settle(draft);

    if ("reject" in outcome) {
      reject(outcome.reject);

      return;
    }

    resolve();
  };

  return {
    peakInFlight: () => state.peak,
    recorded: () => recorded,
    release: () => {
      state.released = true;

      const waiting = pending.splice(0);

      for (const settlePending of waiting) {
        settlePending();
      }
    },
    store: {
      clear: () => Promise.resolve(),
      deleteForUser: () => Promise.resolve(0),
      list: () => Promise.resolve([]),
      purgeOrphaned: () => Promise.resolve([]),
      record: (draft) => {
        recorded.push(draft);
        state.inFlight += 1;
        state.peak = Math.max(state.peak, state.inFlight);

        return new Promise<void>((resolve, reject) => {
          if (state.released) {
            finish(draft, resolve, reject);

            return;
          }

          pending.push(() => {
            finish(draft, resolve, reject);
          });
        });
      },
    },
  };
};

const liveChannels = (): TeardownPushChannel[] =>
  Array.from({ length: CHANNEL_COUNT }, (_unused, index) => ({
    credential: null,
    provider: "google" as const,
    providerChannelId: `google-${DELETED_USER}-${String(index)}`,
    providerResourceId: `resource-${DELETED_USER}-${String(index)}`,
    userId: DELETED_USER,
  }));

interface DependencyOverrides {
  deregisterPushChannels?: (userId: string, signal: AbortSignal) => Promise<number>;
  residue: RecordGate;
}

const makeDependencies = (overrides: DependencyOverrides) => ({
  createQueue: () => ({
    getJob: () => Promise.resolve(undefined),
    remove: () => Promise.resolve(0),
  }),
  deregisterPushChannels:
    overrides.deregisterPushChannels ?? (() => Promise.resolve(CHANNEL_COUNT)),
  listCalendarIds: () => Promise.resolve([]),
  listOAuthCredentials: () => Promise.resolve([]),
  listPushChannels: () => Promise.resolve(liveChannels()),
  redis: {
    del: () => Promise.resolve(1),
    exists: () => Promise.resolve(1),
    set: () => Promise.resolve("OK"),
  },
  residue: overrides.residue.store,
});

const importSyncTeardown = async () => await import("@/utils/delete-user-teardown");

const waitForPeak = async (gate: RecordGate, target: number): Promise<void> => {
  const deadline = Date.now() + CONCURRENCY_WAIT_MS;

  while (gate.peakInFlight() < target && Date.now() < deadline) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 5);
    });
  }
};

describe("push channel residue capture", () => {
  it("issues every dialable channel's record call before any of them settles", async () => {
    const { createDeleteUserSyncTeardown } = await importSyncTeardown();
    const gate = makeRecordGate(() => ({ resolve: true }));
    const deregisterCalls: string[] = [];

    const teardown = createDeleteUserSyncTeardown(
      makeDependencies({
        deregisterPushChannels: (userId) => {
          deregisterCalls.push(userId);

          return Promise.resolve(CHANNEL_COUNT);
        },
        residue: gate,
      }) as never,
    );

    const settled = teardown(DELETED_USER).then(
      () => ({ ok: true }) as const,
      (error: unknown) => ({ error, ok: false }) as const,
    );

    await waitForPeak(gate, CHANNEL_COUNT);

    const peak = gate.peakInFlight();

    gate.release();

    const outcome = await settled;

    expect(peak).toBe(CHANNEL_COUNT);
    expect(outcome).toEqual({ ok: true });
    expect(gate.recorded()).toHaveLength(CHANNEL_COUNT);
    expect(deregisterCalls).toEqual([DELETED_USER]);
  });

  it("still blocks the delete when one concurrent record rejects", async () => {
    const { createDeleteUserSyncTeardown } = await importSyncTeardown();
    const doomedChannelId = `google-${DELETED_USER}-3`;
    const gate = makeRecordGate((draft) =>
      draft.providerChannelId === doomedChannelId
        ? { reject: new Error("write ECONNRESET writing teardown_residue") }
        : { resolve: true });
    const deregisterCalls: string[] = [];

    const teardown = createDeleteUserSyncTeardown(
      makeDependencies({
        deregisterPushChannels: (userId) => {
          deregisterCalls.push(userId);

          return Promise.resolve(CHANNEL_COUNT);
        },
        residue: gate,
      }) as never,
    );

    const settled = teardown(DELETED_USER).then(
      () => ({ ok: true }) as const,
      (error: unknown) => ({ error, ok: false }) as const,
    );

    await waitForPeak(gate, CHANNEL_COUNT);

    const peak = gate.peakInFlight();

    gate.release();

    const outcome = await settled;

    expect(peak).toBe(CHANNEL_COUNT);
    expect(outcome.ok).toBe(false);

    const rejection = outcome.ok ? null : outcome.error;

    expect(rejection).toBeInstanceOf(Error);
    expect((rejection as Error).name).toBe(BLOCKING_ERROR_NAME);
    expect((rejection as Error).message).toContain(DELETED_USER);
    expect((rejection as Error).message).toContain(PUSH_CHANNELS_STEP);
    expect(deregisterCalls).toEqual([]);
  });
});
