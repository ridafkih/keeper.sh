import { describe, expect, it, vi } from "vitest";
import { SDKError } from "@polar-sh/sdk/models/errors/sdkerror.js";
import { runDeregisterPushChannelsOutcome } from "@/utils/push-notifications/deregister-account-channels";
import type {
  RegistrarContext,
  SourcePushRegistrar,
  StoredPushChannel,
} from "@keeper.sh/calendar";

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

const NOW = new Date("2026-08-25T06:15:33.956Z");
const CHANNEL_TTL_MS = 60_000;
const SECRET_HASH = "a".repeat(64);
const DELETED_USER = "A";
const SURVIVING_USER = "B";
const SERVICE_UNAVAILABLE = 503;
const POLAR_CUSTOMER_DELETE_TIMEOUT_MS = 5000;
const AUTH_TEARDOWN_BUDGET_MS = 9000;

interface TeardownResidueRecord {
  credential?: {
    accessToken: string;
    expiresAt: Date | null;
    refreshToken: string | null;
  };
  externalId?: string;
  id: string;
  kind: string;
  provider?: string;
  providerChannelId?: string;
  providerResourceId?: string;
  userId: string;
}

interface ResidueHarness {
  cascadeDeleteUser: (userId: string) => void;
  clearedIds: string[];
  events: string[];
  list: () => Promise<TeardownResidueRecord[]>;
  store: {
    clear: (residueId: string) => Promise<void>;
    list: () => Promise<TeardownResidueRecord[]>;
    purgeOrphaned: () => Promise<string[]>;
    record: (draft: Omit<TeardownResidueRecord, "id">) => Promise<void>;
  };
}

const makeResidueHarness = (events: string[]): ResidueHarness => {
  const rows = new Map<string, TeardownResidueRecord>();
  const clearedIds: string[] = [];

  return {
    cascadeDeleteUser: (userId: string) => {
      events.push(`user-row-delete:${userId}`);
    },
    clearedIds,
    events,
    list: () => Promise.resolve([...rows.values()]),
    store: {
      clear: (residueId: string) => {
        clearedIds.push(residueId);
        rows.delete(residueId);
        return Promise.resolve();
      },
      list: () => Promise.resolve([...rows.values()]),
      purgeOrphaned: () => Promise.resolve([]),
      record: (draft) => {
        const id = `residue-${rows.size + 1}`;
        events.push(`residue:${draft.kind}:${draft.userId}`);
        rows.set(id, { ...draft, id });
        return Promise.resolve();
      },
    },
  };
};

const makeChannel = (overrides: Partial<StoredPushChannel>): StoredPushChannel => ({
  accountId: "account-A",
  calendarId: "cal1",
  createdAt: NOW,
  expiresAt: new Date(NOW.getTime() + CHANNEL_TTL_MS),
  failureCount: 0,
  id: "channel-A-1",
  lastFailureAt: null,
  lastNotificationAt: null,
  nextAttemptAt: null,
  provider: "google",
  providerChannelId: "google-A-1",
  providerResourceId: "resource-A-1",
  reauthorizeRequestedAt: null,
  resourcePath: "/calendars/primary/events",
  secretHash: SECRET_HASH,
  state: "active",
  updatedAt: NOW,
  userId: DELETED_USER,
  verifiedAt: NOW,
  ...overrides,
});

const seedChannels = (): StoredPushChannel[] => [
  makeChannel({}),
  makeChannel({
    accountId: "account-B",
    calendarId: "cal9",
    id: "channel-B-1",
    providerChannelId: "google-B-1",
    providerResourceId: "resource-B-1",
    userId: SURVIVING_USER,
  }),
];

const makeRegistrar = (
  provider: string,
  deregister: (channel: StoredPushChannel, context: RegistrarContext) => Promise<void>,
): SourcePushRegistrar => ({
  deregister,
  list: () => Promise.resolve([]),
  maxLifetimeMs: CHANNEL_TTL_MS,
  provider,
  register: () => Promise.reject(new Error("register is not exercised by this suite")),
  renew: () => Promise.reject(new Error("renew is not exercised by this suite")),
  renewalMode: "recreate",
  resolveAffectedCalendarIds: () => Promise.resolve([]),
  scopeKind: "calendar",
  supportsList: true,
});

const registrarContextFor = (channel: StoredPushChannel): RegistrarContext => ({
  accessToken: `access-token-for-${channel.accountId}`,
  channelId: channel.providerChannelId,
  fetchImpl: globalThis.fetch,
  notificationUrl: "https://keeper.example/api/webhook/google",
  now: NOW,
  requestedExpiresAt: NOW,
});

const abandonEveryChannel = async (
  userId: string,
  channels: StoredPushChannel[],
  loggedErrors: LoggedError[],
  loggedFields: Record<string, unknown>[],
): Promise<never> => {
  const registrar = makeRegistrar(
    "google",
    () => Promise.reject(new Error("googleapis channels.stop responded 500")),
  );

  const outcome = await runDeregisterPushChannelsOutcome(
    userId,
    {
      createRegistrarContext: (channel) => Promise.resolve(registrarContextFor(channel)),
      listLiveChannels: (scopeId) =>
        Promise.resolve(channels.filter((channel) => channel.userId === scopeId)),
      observe: (fields) => {
        loggedFields.push(fields);
      },
      recordError: (error, slug) => {
        loggedErrors.push({ error, fields: { slug } });
      },
      resolveRegistrar: () => registrar,
      webhookConfigured: true,
    },
    null,
    1,
    false,
  );

  throw new AggregateError(
    outcome.abandonments,
    `${outcome.abandonments.length} push channel(s) for userId ${userId} were left running at their provider`,
  );
};

const makeSyncDependencies = (
  residue: ResidueHarness,
  channels: StoredPushChannel[],
  capture: WideEventCapture,
) => ({
  createQueue: () => ({
    getJob: () => Promise.resolve(undefined),
    remove: () => Promise.resolve(0),
  }),
  deregisterPushChannels: (userId: string) =>
    abandonEveryChannel(userId, channels, capture.loggedErrors, capture.loggedFields),
  listCalendarIds: () => Promise.resolve([]),
  listPushChannels: () => Promise.resolve([]),
  redis: {
    del: () => Promise.resolve(1),
    exists: () => Promise.resolve(1),
    set: () => Promise.resolve("OK"),
  },
  residue: residue.store,
});

const importSyncTeardown = async () => await import("@/utils/delete-user-teardown");

const importAuthTeardown = async () =>
  await import("@keeper.sh/auth/src/delete-user-teardown");

const importResidueReaper = async () =>
  await import("@/utils/teardown-residue-reaper");

describe("abandoned push channels leave durable repairable residue", () => {
  it("persists provider identity and credential material for a channel the provider never stopped", async () => {
    const capture = await startWideEventCapture();
    const { createDeleteUserSyncTeardown } = await importSyncTeardown();
    const events: string[] = [];
    const residue = makeResidueHarness(events);
    const channels = seedChannels();

    await expect(
      createDeleteUserSyncTeardown(
        makeSyncDependencies(residue, channels, capture) as never,
      )(DELETED_USER),
    ).resolves.toBeUndefined();

    residue.cascadeDeleteUser(DELETED_USER);

    const rows = await residue.list();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "push_channel",
      provider: "google",
      providerChannelId: "google-A-1",
      providerResourceId: "resource-A-1",
      userId: DELETED_USER,
    });
    expect(rows[0]?.credential?.accessToken).toBeTypeOf("string");

    const residueIndex = events.findIndex((event) => event.startsWith("residue:"));
    const deleteIndex = events.indexOf(`user-row-delete:${DELETED_USER}`);

    expect(residueIndex).toBeGreaterThanOrEqual(0);
    expect(residueIndex).toBeLessThan(deleteIndex);
  });

  it("never writes residue keyed to a user who was not deleted", async () => {
    const capture = await startWideEventCapture();
    const { createDeleteUserSyncTeardown } = await importSyncTeardown();
    const events: string[] = [];
    const residue = makeResidueHarness(events);
    const channels = seedChannels();

    await createDeleteUserSyncTeardown(
      makeSyncDependencies(residue, channels, capture) as never,
    )(DELETED_USER);

    const rows = await residue.list();

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.userId === DELETED_USER)).toBe(true);
    expect(rows.some((row) => row.providerChannelId === "google-B-1")).toBe(false);
  });
});

describe("a Polar deletion the provider refused leaves durable repairable residue", () => {
  const buildPolarServiceUnavailable = (): SDKError =>
    new SDKError("Polar customer deletion failed", {
      body: '{"detail":"Service Unavailable"}',
      request: new Request("https://api.polar.sh/v1/customers/external/A", {
        method: "DELETE",
      }),
      response: new Response('{"detail":"Service Unavailable"}', {
        headers: { "content-type": "application/json" },
        status: SERVICE_UNAVAILABLE,
      }),
    });

  it("records the externalId and names the user on the emitted failure event", async () => {
    const capture = await startWideEventCapture();
    const { createDeleteUserTeardown } = await importAuthTeardown();
    const { deletePolarCustomerByExternalId } = await import(
      "@keeper.sh/auth/src/polar-customer-delete"
    );
    const events: string[] = [];
    const residue = makeResidueHarness(events);
    const deleteExternal = vi.fn(() => Promise.reject(buildPolarServiceUnavailable()));

    const teardown = (
      createDeleteUserTeardown as unknown as (
        steps: unknown[],
        budgetMs: number,
        options: { recordResidue: ResidueHarness["store"]["record"] },
      ) => (userId: string) => Promise<void>
    )(
      [
        {
          name: "polar_customer",
          run: (userId: string) =>
            deletePolarCustomerByExternalId({ customers: { deleteExternal } }, userId),
          timeoutMs: POLAR_CUSTOMER_DELETE_TIMEOUT_MS,
        },
      ],
      AUTH_TEARDOWN_BUDGET_MS,
      { recordResidue: residue.store.record },
    );

    await expect(teardown(DELETED_USER)).resolves.toBeUndefined();

    const rows = await residue.list();

    expect(deleteExternal).toHaveBeenCalledWith({ externalId: DELETED_USER });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      externalId: DELETED_USER,
      kind: "polar_customer",
      userId: DELETED_USER,
    });

    const failure = capture.loggedErrors.at(-1);

    expect(failure).toBeDefined();
    expect(JSON.stringify(failure?.fields)).toContain(DELETED_USER);
  });
});

describe("the teardown residue reaper", () => {
  const seedPushResidue = async (residue: ResidueHarness): Promise<void> => {
    await residue.store.record({
      credential: {
        accessToken: "access-token-for-account-A",
        expiresAt: null,
        refreshToken: "refresh-token-for-account-A",
      },
      kind: "push_channel",
      provider: "google",
      providerChannelId: "google-A-1",
      providerResourceId: "resource-A-1",
      userId: DELETED_USER,
    });
  };

  const buildReaperDependencies = (
    residue: ResidueHarness,
    registrar: SourcePushRegistrar,
    deletedPolarExternalIds: string[],
  ) => ({
    countSurvivingAccountLinks: () =>
      Promise.resolve({ coHolders: 0, identityResolved: true }),
    createRegistrarContext: (record: TeardownResidueRecord) =>
      Promise.resolve({
        accessToken: record.credential?.accessToken ?? "",
        channelId: record.providerChannelId ?? null,
        fetchImpl: globalThis.fetch,
        notificationUrl: "https://keeper.example/api/webhook/google",
        now: NOW,
        requestedExpiresAt: NOW,
      }),
    deletePolarCustomer: (externalId: string) => {
      deletedPolarExternalIds.push(externalId);
      return Promise.resolve();
    },
    now: () => NOW,
    observe: () => undefined,
    recordError: () => undefined,
    residue: residue.store,
    resolveRegistrar: () => registrar,
  });

  it("stops the abandoned channel at the provider and clears the record", async () => {
    const { createTeardownResidueReaper } = await importResidueReaper();
    const residue = makeResidueHarness([]);
    const dialed: Array<{ channelId: string | null; resourceId: string | null }> = [];
    const registrar = makeRegistrar("google", (channel) => {
      dialed.push({
        channelId: channel.providerChannelId,
        resourceId: channel.providerResourceId,
      });
      return Promise.resolve();
    });

    await seedPushResidue(residue);

    await (
      createTeardownResidueReaper as unknown as (
        dependencies: unknown,
      ) => () => Promise<unknown>
    )(buildReaperDependencies(residue, registrar, []))();

    expect(dialed).toEqual([{ channelId: "google-A-1", resourceId: "resource-A-1" }]);
    await expect(residue.list()).resolves.toEqual([]);
  });

  it("keeps the record for the next run when the provider stop fails transiently", async () => {
    const { createTeardownResidueReaper } = await importResidueReaper();
    const residue = makeResidueHarness([]);
    const registrar = makeRegistrar(
      "google",
      () => Promise.reject(new Error("googleapis channels.stop responded 503")),
    );

    await seedPushResidue(residue);

    await (
      createTeardownResidueReaper as unknown as (
        dependencies: unknown,
      ) => () => Promise<unknown>
    )(buildReaperDependencies(residue, registrar, []))();

    const rows = await residue.list();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ providerChannelId: "google-A-1" });
    expect(residue.clearedIds).toEqual([]);
  });

  it("makes no provider call at all when there is no residue", async () => {
    const { createTeardownResidueReaper } = await importResidueReaper();
    const residue = makeResidueHarness([]);
    const dialed: string[] = [];
    const deletedPolarExternalIds: string[] = [];
    const registrar = makeRegistrar("google", (channel) => {
      dialed.push(String(channel.providerChannelId));
      return Promise.resolve();
    });

    await (
      createTeardownResidueReaper as unknown as (
        dependencies: unknown,
      ) => () => Promise<unknown>
    )(buildReaperDependencies(residue, registrar, deletedPolarExternalIds))();

    expect(dialed).toEqual([]);
    expect(deletedPolarExternalIds).toEqual([]);
  });
});
