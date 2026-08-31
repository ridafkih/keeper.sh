import { describe, expect, it, vi } from "vitest";

interface LoggedError {
  error: unknown;
  fields: Record<string, unknown>;
}

interface WideEventCapture {
  loggedErrors: LoggedError[];
  loggedFields: Record<string, unknown>[];
}

vi.mock("widelogger", () => {
  const loggedErrors: LoggedError[] = [];
  const loggedFields: Record<string, unknown>[] = [];

  return {
    startWideEventCapture: (): WideEventCapture => {
      loggedErrors.length = 0;
      loggedFields.length = 0;
      return { loggedErrors, loggedFields };
    },
    widelog: {
      error: (prefix: string, error: unknown) => {
        loggedErrors.push({ error, fields: { prefix } });
      },
      errorFields: (error: unknown, fields: Record<string, unknown>) => {
        loggedErrors.push({ error, fields });
      },
      errors: () => undefined,
      flush: () => undefined,
      set: (key: string, value: unknown) => {
        loggedFields.push({ [key]: value });
      },
      setFields: (fields: Record<string, unknown>) => {
        loggedFields.push(fields);
      },
    },
    widelogger: () => ({
      context: (run: () => unknown) => run(),
      destroy: () => Promise.resolve(),
    }),
  };
});

const startWideEventCapture = async (): Promise<WideEventCapture> => {
  const logging = (await import("widelogger")) as unknown as {
    startWideEventCapture: () => WideEventCapture;
  };

  return logging.startWideEventCapture();
};

const SURVIVING_USER = "user-whose-delete-was-rolled-back";
const ABANDONED_CHANNEL_COUNT = 20;
const RESIDUE_INSERT_MS = 500;
const RESIDUE_DRAIN_GRACE_MS = 12_000;
const PROVIDER_OUTAGE = "google refused channels.stop for every channel";

interface ResidueRow {
  credential?: { accessToken: string; expiresAt: Date | null; refreshToken: string | null };
  externalId?: string;
  id: string;
  kind: string;
  provider?: string;
  providerChannelId?: string;
  providerResourceId?: string;
  userId: string;
}

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const createResidueHarness = () => {
  const rows = new Map<string, ResidueRow>();
  const issued = { count: 0 };

  return {
    rowsFor: (userId: string): ResidueRow[] =>
      [...rows.values()].filter((row) => row.userId === userId),
    store: {
      clear: (residueId: string): Promise<void> => {
        rows.delete(residueId);
        return Promise.resolve();
      },
      deleteForUser: (userId: string, kind: string) => {
        const doomed = [...rows.values()].filter(
          (row) => row.userId === userId && row.kind === kind,
        );

        for (const row of doomed) {
          rows.delete(row.id);
        }

        return Promise.resolve(doomed.length);
      },
      list: () => Promise.resolve([...rows.values()]),
      record: async (draft: Omit<ResidueRow, "id">) => {
        await delay(RESIDUE_INSERT_MS);

        issued.count += 1;

        rows.set(`residue-${issued.count}`, { ...draft, id: `residue-${issued.count}` });
      },
    },
  };
};

const createRedisHarness = () => {
  const keys = new Map<string, string>();

  return {
    del: (key: string) => Promise.resolve(keys.delete(key) ? 1 : 0),
    exists: (key: string) => Promise.resolve(keys.has(key) ? 1 : 0),
    set: (key: string, value: string) => {
      keys.set(key, value);
      return Promise.resolve("OK");
    },
  };
};

const liveCredential = {
  accessToken: "live-access-token",
  expiresAt: null,
  refreshToken: "live-refresh-token",
};

const fieldValue = (capture: WideEventCapture, key: string): unknown =>
  capture.loggedFields.reduce<unknown>(
    (found, fields) => (key in fields ? fields[key] : found),
    undefined,
  );

describe("every residue write is registered before it is awaited", () => {
  it(
    "leaves no residue behind for a user who still exists, however many channels were abandoned",
    async () => {
      const capture = await startWideEventCapture();

      const { createDeleteUserSyncTeardown, createDeleteUserSyncTeardownRollback } = await import(
        "@/utils/delete-user-teardown"
      );
      const { AbandonedPushChannelError } = await import(
        "@/utils/push-notifications/deregister-account-channels"
      );
      const { createDeleteUserTeardown, SYNC_TEARDOWN_TIMEOUT_MS } = await import(
        "@keeper.sh/auth/src/delete-user-teardown"
      );

      const residue = createResidueHarness();
      const redis = createRedisHarness();

      const abandoned = Array.from({ length: ABANDONED_CHANNEL_COUNT }, (_unused, index) =>
        new AbandonedPushChannelError(
          PROVIDER_OUTAGE,
          {
            credential: liveCredential,
            provider: "google",
            providerChannelId: `channel-${index + 1}`,
            providerResourceId: `resource-${index + 1}`,
          },
          { cause: new Error(PROVIDER_OUTAGE) },
        ),
      );

      const dependencies = {
        createQueue: () => ({
          getJob: () => Promise.resolve(undefined),
          remove: () => Promise.resolve(0),
        }),
        deregisterPushChannels: () =>
          Promise.reject(
            new AggregateError(
              abandoned,
              `${ABANDONED_CHANNEL_COUNT} push channel(s) for userId ${SURVIVING_USER} were left running at their provider`,
            ),
          ),
        fetchImpl: () => Promise.reject(new Error("no provider call belongs in this test")),
        listCalendarIds: () => Promise.resolve([]),
        listOAuthGrantProviders: () => Promise.resolve([]),
        redis,
        listPushChannels: () => Promise.resolve([]),
        residue: residue.store,
      };

      const quiesce = createDeleteUserTeardown([
        {
          name: "sync",
          run: createDeleteUserSyncTeardown(dependencies as never),
          timeoutMs: SYNC_TEARDOWN_TIMEOUT_MS,
        },
      ]);

      await quiesce(SURVIVING_USER);

      await createDeleteUserSyncTeardownRollback(dependencies as never)(SURVIVING_USER);

      expect(residue.rowsFor(SURVIVING_USER)).toEqual([]);

      expect(fieldValue(capture, "delete_user.late_residue_writes_awaited")).toBeGreaterThan(0);

      await delay(RESIDUE_DRAIN_GRACE_MS);

      expect(residue.rowsFor(SURVIVING_USER)).toEqual([]);
    },
    60_000,
  );
});
