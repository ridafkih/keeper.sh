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

const SURVIVING_USER = "A";
const LIVE_CHANNEL_ID = "google-A-1";
const LIVE_RESOURCE_ID = "google-A-resource-1";
const RESIDUE_INSERT_MS = 2600;
const LATE_WRITE_GRACE_MS = 2000;
const LEFT_BEHIND_MESSAGE = "residue recorded after the discard is left behind";

interface ResidueRow {
  credential?: { accessToken: string; expiresAt: Date | null; refreshToken: string | null };
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

describe("capture-phase residue writes are registered before the rollback discards", () => {
  it(
    "leaves no residue behind for a live user whose capture INSERT outran its step deadline",
    async () => {
      await startWideEventCapture();

      const {
        createDeleteUserSyncTeardown,
        createDeleteUserSyncTeardownRollback,
        TeardownBlockedError,
      } = await import("@/utils/delete-user-teardown");

      const residue = createResidueHarness();
      const redis = createRedisHarness();

      const dependencies = {
        createQueue: () => ({
          getJob: () => Promise.resolve(undefined),
          remove: () => Promise.resolve(0),
        }),
        deregisterPushChannels: () =>
          Promise.reject(
            new Error("deregistration must never be reached once the capture is blocked"),
          ),
        listCalendarIds: () => Promise.resolve([]),
        listOAuthGrantProviders: () => Promise.resolve([]),
        listPushChannels: () =>
          Promise.resolve([
            {
              credential: liveCredential,
              provider: "google",
              providerChannelId: LIVE_CHANNEL_ID,
              providerResourceId: LIVE_RESOURCE_ID,
              userId: SURVIVING_USER,
            },
          ]),
        redis,
        residue: residue.store,
      };

      await expect(
        createDeleteUserSyncTeardown(dependencies as never)(SURVIVING_USER),
      ).rejects.toBeInstanceOf(TeardownBlockedError);

      const rollback = await createDeleteUserSyncTeardownRollback(dependencies as never)(
        SURVIVING_USER,
      ).then(
        () => null,
        (error: unknown) => error,
      );

      if (rollback !== null) {
        expect(String(rollback)).toContain(LEFT_BEHIND_MESSAGE);
      }

      await delay(LATE_WRITE_GRACE_MS);

      expect(residue.rowsFor(SURVIVING_USER)).toEqual([]);
    },
    60_000,
  );
});
