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

const ROLLED_BACK_USER = "user-still-here";
const PUSH_CHANNEL_KIND = "push_channel";
const ABANDONED_CHANNEL_ID = "chan-1";
const ABANDONED_RESOURCE_ID = "resource-1";
const PROVIDER_SETTLES_AT_MS = 4200;
const SETTLEMENT_GRACE_MS = 1500;
const PROVIDER_OUTAGE = "google never confirmed channels.stop";

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
      list: () =>
        Promise.resolve([...rows.values()].filter((row) => row.kind === PUSH_CHANNEL_KIND)),
      record: (draft: Omit<ResidueRow, "id">) => {
        issued.count += 1;

        const id = `residue-${issued.count}`;

        rows.set(id, { ...draft, id });

        return Promise.resolve();
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

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

describe("a rolled back delete discards push residue that lands after the abort window", () => {
  it(
    "leaves nothing behind for a user who was never deleted, even when the provider settles late",
    async () => {
      await startWideEventCapture();

      const { createDeleteUserSyncTeardown, createDeleteUserSyncTeardownRollback } = await import(
        "@/utils/delete-user-teardown"
      );
      const { AbandonedPushChannelError } = await import(
        "@/utils/push-notifications/deregister-account-channels"
      );

      const residue = createResidueHarness();
      const redis = createRedisHarness();

      const dependencies = {
        createQueue: () => ({
          getJob: () => Promise.resolve(undefined),
          remove: () => Promise.resolve(0),
        }),
        deregisterPushChannels: () =>
          new Promise<number>((_resolve, reject) => {
            setTimeout(() => {
              reject(
                new AggregateError(
                  [
                    new AbandonedPushChannelError(
                      PROVIDER_OUTAGE,
                      {
                        credential: liveCredential,
                        provider: "google",
                        providerChannelId: ABANDONED_CHANNEL_ID,
                        providerResourceId: ABANDONED_RESOURCE_ID,
                      },
                      { cause: new Error(PROVIDER_OUTAGE) },
                    ),
                  ],
                  `1 push channel(s) for userId ${ROLLED_BACK_USER} were left running at their provider`,
                ),
              );
            }, PROVIDER_SETTLES_AT_MS);
          }),
        fetchImpl: () => Promise.reject(new Error("no provider call belongs in this test")),
        listCalendarIds: () => Promise.resolve([]),
        redis,
        listPushChannels: () => Promise.resolve([]),
        residue: residue.store,
      };

      await createDeleteUserSyncTeardown(dependencies as never)(ROLLED_BACK_USER);

      await createDeleteUserSyncTeardownRollback(dependencies as never)(ROLLED_BACK_USER);

      expect(residue.rowsFor(ROLLED_BACK_USER)).toEqual([]);

      await delay(PROVIDER_SETTLES_AT_MS + SETTLEMENT_GRACE_MS);

      expect(residue.rowsFor(ROLLED_BACK_USER)).toEqual([]);
    },
    30_000,
  );
});
