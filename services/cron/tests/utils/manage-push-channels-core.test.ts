import { describe, expect, it, vi } from "vitest";
import type {
  EligibleSourceCalendar,
  PushChannelRegistration,
  SourcePushRegistrar,
  StoredPushChannel,
} from "@keeper.sh/calendar";
import {
  runManagePushChannels,
  type RegistrarContextRequest,
} from "../../src/utils/manage-push-channels-core";

const NOW = new Date("2026-08-12T00:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;
const WEBHOOK_URL = "https://www.example.com";
const SECRET = "d".repeat(64);

const makeCalendar = (
  overrides: Partial<EligibleSourceCalendar> = {},
): EligibleSourceCalendar => ({
  accountId: "account-1",
  calendarId: "cal-1",
  capabilities: ["pull"],
  disabled: false,
  externalCalendarId: "external-1",
  needsReauthentication: false,
  provider: "google",
  providerAccountId: "provider-account-1",
  userId: "user-1",
  ...overrides,
});

const makeChannel = (
  overrides: Partial<StoredPushChannel> = {},
): StoredPushChannel => ({
  accountId: "account-1",
  calendarId: "cal-1",
  createdAt: NOW,
  expiresAt: new Date(NOW.getTime() + 6 * 24 * HOUR_MS),
  failureCount: 0,
  id: "channel-1",
  lastFailureAt: null,
  lastNotificationAt: NOW,
  nextAttemptAt: null,
  provider: "google",
  providerChannelId: "google-channel-1",
  providerResourceId: "google-resource-1",
  reauthorizeRequestedAt: null,
  resourcePath: "/calendars/external-1/events",
  secretHash: "a".repeat(64),
  state: "active",
  updatedAt: NOW,
  userId: "user-1",
  verifiedAt: NOW,
  ...overrides,
});

const makeRegistration = (
  overrides: Partial<PushChannelRegistration> = {},
): PushChannelRegistration => ({
  expiresAt: new Date(NOW.getTime() + 6 * 24 * HOUR_MS),
  providerChannelId: "google-channel-2",
  providerResourceId: "google-resource-2",
  resourcePath: "/calendars/external-1/events",
  ...overrides,
});

type MockRegistrar = SourcePushRegistrar & {
  deregister: ReturnType<typeof vi.fn>;
  list: ReturnType<typeof vi.fn>;
  register: ReturnType<typeof vi.fn>;
  renew: ReturnType<typeof vi.fn>;
};

const makeRegistrar = (
  callLog: string[],
  overrides: Partial<SourcePushRegistrar> = {},
): MockRegistrar => ({
  deregister: vi.fn(() => {
    callLog.push("registrar.deregister");
    return Promise.resolve();
  }),
  list: vi.fn(() => {
    callLog.push("registrar.list");
    return Promise.resolve([]);
  }),
  maxLifetimeMs: 7 * 24 * HOUR_MS,
  provider: "google",
  register: vi.fn(() => {
    callLog.push("registrar.register");
    return Promise.resolve(makeRegistration());
  }),
  renew: vi.fn(() => {
    callLog.push("registrar.renew");
    return Promise.resolve(makeRegistration());
  }),
  renewalMode: "recreate",
  resolveAffectedCalendarIds: vi.fn(() => Promise.resolve(["cal-1"])),
  scopeKind: "calendar",
  supportsList: false,
  ...overrides,
} as unknown as MockRegistrar);

const makeDependencies = (
  callLog: string[],
  overrides: Record<string, unknown> = {},
) => {
  const registrar = makeRegistrar(callLog);

  return {
    createRegistrarContext: vi.fn((request: RegistrarContextRequest) => Promise.resolve({
      accessToken: "access-token-1",
      channelId: request.channelId,
      fetchImpl: globalThis.fetch,
      notificationUrl: `${WEBHOOK_URL}/api/webhook/${request.provider}`,
      now: NOW,
      requestedExpiresAt: new Date(NOW.getTime() + 6 * 24 * HOUR_MS),
    })),
    deleteNegativeCacheKey: vi.fn(() => Promise.resolve()),
    generateChannelId: vi.fn(() => "generated-channel-id"),
    generateSecret: vi.fn(() => SECRET),
    insertChannel: vi.fn((row: Record<string, unknown>) => {
      callLog.push("insertChannel");
      return Promise.resolve(makeChannel({
        expiresAt: null,
        id: "channel-new",
        providerChannelId: (row.providerChannelId as string | null) ?? null,
        state: "registering",
        verifiedAt: null,
        ...row,
      } as Partial<StoredPushChannel>));
    }),
    now: () => NOW,
    observe: vi.fn(),
    readChannel: vi.fn((channelId: string) => Promise.resolve(makeChannel({ id: channelId }))),
    recordError: vi.fn(),
    registrar,
    releaseLock: vi.fn(() => Promise.resolve()),
    resolvePlan: vi.fn(() => Promise.resolve("pro" as const)),
    resolveRegistrar: vi.fn(() => registrar),
    selectChannels: vi.fn(() => Promise.resolve([])),
    selectEligibleCalendars: vi.fn(() => Promise.resolve([makeCalendar()])),
    tryAcquireLock: vi.fn(() => Promise.resolve(true)),
    updateChannel: vi.fn((_channelId: string, _updates: Record<string, unknown>) => {
      callLog.push("updateChannel");
      return Promise.resolve();
    }),
    webhookPublicUrl: WEBHOOK_URL,
    ...overrides,
  };
};

const observedFields = (
  observe: ReturnType<typeof vi.fn>,
): Record<string, unknown> => {
  const merged: Record<string, unknown> = {};
  for (const call of observe.mock.calls) {
    Object.assign(merged, call[0]);
  }
  return merged;
};

describe("runManagePushChannels when push is unconfigured", () => {
  it("returns immediately with zero dependency calls", async () => {
    const callLog: string[] = [];
    const dependencies = makeDependencies(callLog, { webhookPublicUrl: null });

    await runManagePushChannels(dependencies);

    expect(callLog).toEqual([]);
    expect(dependencies.tryAcquireLock).not.toHaveBeenCalled();
    expect(dependencies.selectEligibleCalendars).not.toHaveBeenCalled();
    expect(dependencies.selectChannels).not.toHaveBeenCalled();
    expect(dependencies.resolvePlan).not.toHaveBeenCalled();
    expect(dependencies.resolveRegistrar).not.toHaveBeenCalled();
    expect(dependencies.registrar.register).not.toHaveBeenCalled();
    expect(dependencies.registrar.renew).not.toHaveBeenCalled();
    expect(dependencies.registrar.deregister).not.toHaveBeenCalled();
  });
});

describe("runManagePushChannels registration", () => {
  it("inserts a registering row before contacting the provider", async () => {
    const callLog: string[] = [];
    const dependencies = makeDependencies(callLog);

    await runManagePushChannels(dependencies);

    expect(callLog.indexOf("insertChannel")).toBeGreaterThanOrEqual(0);
    expect(callLog.indexOf("insertChannel"))
      .toBeLessThan(callLog.indexOf("registrar.register"));

    const [inserted] = dependencies.insertChannel.mock.calls[0] as [Record<string, unknown>];
    expect(inserted.state).toBe("registering");
    expect(inserted.expiresAt).toBeNull();
    expect(String(inserted.secretHash)).toHaveLength(64);
    expect(inserted.providerChannelId).toBe("generated-channel-id");
    for (const value of Object.values(inserted)) {
      expect(value).not.toBe(SECRET);
    }
  });

  it("hands the plaintext secret only to the registrar", async () => {
    const callLog: string[] = [];
    const dependencies = makeDependencies(callLog);

    await runManagePushChannels(dependencies);

    const [, secret] = dependencies.registrar.register.mock.calls[0] as [unknown, string];
    expect(secret).toBe(SECRET);
  });

  it("leaves the provider channel id unset for Outlook until Graph assigns one", async () => {
    const callLog: string[] = [];
    const outlookRegistrar = makeRegistrar(callLog, {
      provider: "outlook",
      renewalMode: "extend",
      supportsList: true,
    });
    const dependencies = makeDependencies(callLog, {
      registrar: outlookRegistrar,
      resolveRegistrar: vi.fn(() => outlookRegistrar),
      selectEligibleCalendars: vi.fn(() => Promise.resolve([
        makeCalendar({ provider: "outlook" }),
      ])),
    });

    await runManagePushChannels(dependencies);

    const [inserted] = dependencies.insertChannel.mock.calls[0] as [Record<string, unknown>];
    expect(inserted.providerChannelId).toBeNull();
  });

  it("activates the row with the provider-assigned fields and clears the negative cache", async () => {
    const callLog: string[] = [];
    const dependencies = makeDependencies(callLog);

    await runManagePushChannels(dependencies);

    const activation = dependencies.updateChannel.mock.calls.at(-1) as [string, Record<string, unknown>];
    expect(activation[1]).toMatchObject({
      expiresAt: new Date(NOW.getTime() + 6 * 24 * HOUR_MS),
      providerChannelId: "google-channel-2",
      providerResourceId: "google-resource-2",
      resourcePath: "/calendars/external-1/events",
      state: "active",
    });
    expect(dependencies.deleteNegativeCacheKey)
      .toHaveBeenCalledWith("google", "google-channel-2");
  });

  it("leaves a recoverable row and backs off when registration fails", async () => {
    const callLog: string[] = [];
    const registrar = makeRegistrar(callLog, {
      register: vi.fn(() => Promise.reject(new Error("quotaExceeded"))),
    });
    const dependencies = makeDependencies(callLog, {
      registrar,
      resolveRegistrar: vi.fn(() => registrar),
    });

    await expect(runManagePushChannels(dependencies)).resolves.toBeUndefined();

    const backoff = dependencies.updateChannel.mock.calls.at(-1) as [string, Record<string, unknown>];
    expect(backoff[1].failureCount).toBe(1);
    expect(backoff[1].nextAttemptAt).toBeInstanceOf(Date);
    expect(backoff[1].state).not.toBe("active");
    expect(dependencies.recordError).toHaveBeenCalled();
  });

  it("retries a failed registration on a later tick until it succeeds", async () => {
    const callLog: string[] = [];
    const clock = { current: NOW };
    let stored: StoredPushChannel | null = null;
    let attempts = 0;

    const registrar = makeRegistrar(callLog, {
      register: vi.fn(() => {
        callLog.push("registrar.register");
        attempts += 1;
        if (attempts === 1) {
          return Promise.reject(new Error("quotaExceeded"));
        }
        return Promise.resolve(makeRegistration());
      }),
      renew: vi.fn((channel: StoredPushChannel) => {
        callLog.push("registrar.renew");
        if (!channel.resourcePath) {
          return Promise.reject(new Error(
            "Google push renewal requires the recorded resource path",
          ));
        }
        return Promise.resolve(makeRegistration());
      }),
    });

    const dependencies = makeDependencies(callLog, {
      insertChannel: vi.fn((row: Record<string, unknown>) => {
        callLog.push("insertChannel");
        stored = makeChannel({
          expiresAt: null,
          id: "channel-new",
          state: "registering",
          updatedAt: clock.current,
          verifiedAt: null,
          ...row,
        } as Partial<StoredPushChannel>);
        return Promise.resolve(stored);
      }),
      now: () => clock.current,
      readChannel: vi.fn(() => Promise.resolve(stored)),
      registrar,
      resolveRegistrar: vi.fn(() => registrar),
      selectChannels: vi.fn(() => Promise.resolve([stored].filter(
        (channel): channel is StoredPushChannel => channel !== null,
      ))),
      updateChannel: vi.fn((_channelId: string, updates: Record<string, unknown>) => {
        callLog.push("updateChannel");
        stored = { ...stored as StoredPushChannel, ...updates, updatedAt: clock.current };
        return Promise.resolve();
      }),
    });

    await runManagePushChannels(dependencies);
    expect(stored).not.toBeNull();
    expect((stored as unknown as StoredPushChannel).state).not.toBe("active");

    clock.current = new Date(NOW.getTime() + HOUR_MS);
    await runManagePushChannels(dependencies);

    expect(registrar.register).toHaveBeenCalledTimes(2);
    expect(registrar.renew).not.toHaveBeenCalled();
    expect((stored as unknown as StoredPushChannel).state).toBe("active");
  });

  it("retries a stale registering Google row with a fresh provider channel id", async () => {
    const callLog: string[] = [];
    const stale = makeChannel({
      expiresAt: null,
      providerChannelId: "google-channel-stale",
      state: "registering",
      updatedAt: new Date(NOW.getTime() - HOUR_MS),
      verifiedAt: null,
    });
    const dependencies = makeDependencies(callLog, {
      readChannel: vi.fn(() => Promise.resolve(stale)),
      selectChannels: vi.fn(() => Promise.resolve([stale])),
    });

    await runManagePushChannels(dependencies);

    expect(dependencies.insertChannel).not.toHaveBeenCalled();
    expect(dependencies.registrar.register).toHaveBeenCalled();

    const [request] = dependencies.createRegistrarContext.mock.calls[0] as [
      { channelId: string | null },
    ];
    expect(request.channelId).toBe("generated-channel-id");
    expect(request.channelId).not.toBe("google-channel-stale");
    expect(observedFields(dependencies.observe)["push_channel.orphan_suspected"]).toBe(1);
  });
});

describe("runManagePushChannels renewal", () => {
  it("creates the replacement Google channel before stopping the old one", async () => {
    const callLog: string[] = [];
    const expiring = makeChannel({ expiresAt: new Date(NOW.getTime() + HOUR_MS) });
    const dependencies = makeDependencies(callLog, {
      readChannel: vi.fn(() => Promise.resolve(expiring)),
      selectChannels: vi.fn(() => Promise.resolve([expiring])),
    });

    await runManagePushChannels(dependencies);

    const creationIndex = Math.max(
      callLog.indexOf("registrar.register"),
      callLog.indexOf("registrar.renew"),
    );
    expect(creationIndex).toBeGreaterThanOrEqual(0);
    expect(creationIndex).toBeLessThan(callLog.indexOf("registrar.deregister"));

    const activation = dependencies.updateChannel.mock.calls.at(-1) as [string, Record<string, unknown>];
    expect(activation[1].providerChannelId).toBe("google-channel-2");
  });

  it("extends an Outlook subscription in place", async () => {
    const callLog: string[] = [];
    const outlookRegistrar = makeRegistrar(callLog, {
      provider: "outlook",
      renewalMode: "extend",
      renew: vi.fn(() => {
        callLog.push("registrar.renew");
        return Promise.resolve(makeRegistration({
          providerChannelId: "graph-subscription-1",
          providerResourceId: null,
        }));
      }),
      supportsList: true,
    });
    const expiring = makeChannel({
      expiresAt: new Date(NOW.getTime() + HOUR_MS),
      provider: "outlook",
      providerChannelId: "graph-subscription-1",
      providerResourceId: null,
    });
    const dependencies = makeDependencies(callLog, {
      readChannel: vi.fn(() => Promise.resolve(expiring)),
      registrar: outlookRegistrar,
      resolveRegistrar: vi.fn(() => outlookRegistrar),
      selectChannels: vi.fn(() => Promise.resolve([expiring])),
      selectEligibleCalendars: vi.fn(() => Promise.resolve([
        makeCalendar({ provider: "outlook" }),
      ])),
    });

    await runManagePushChannels(dependencies);

    expect(callLog).toContain("registrar.renew");
    expect(callLog).not.toContain("registrar.deregister");
  });

  it("mints no secret for a renewal that keeps the stored one", async () => {
    const callLog: string[] = [];
    const outlookRegistrar = makeRegistrar(callLog, {
      provider: "outlook",
      renew: vi.fn(() => {
        callLog.push("registrar.renew");
        return Promise.resolve(makeRegistration({
          providerChannelId: "graph-subscription-1",
          providerResourceId: null,
        }));
      }),
      renewalMode: "extend",
      supportsList: false,
    });
    const expiring = makeChannel({
      expiresAt: new Date(NOW.getTime() + HOUR_MS),
      provider: "outlook",
      providerChannelId: "graph-subscription-1",
      providerResourceId: null,
    });
    const dependencies = makeDependencies(callLog, {
      readChannel: vi.fn(() => Promise.resolve(expiring)),
      registrar: outlookRegistrar,
      resolveRegistrar: vi.fn(() => outlookRegistrar),
      selectChannels: vi.fn(() => Promise.resolve([expiring])),
      selectEligibleCalendars: vi.fn(() => Promise.resolve([
        makeCalendar({ provider: "outlook" }),
      ])),
    });

    await runManagePushChannels(dependencies);

    expect(callLog).toContain("registrar.renew");
    expect(dependencies.generateSecret).not.toHaveBeenCalled();
    expect(outlookRegistrar.renew.mock.calls.at(0)?.at(1)).toBeNull();
  });

  it("does nothing when the tick lock is held by another replica", async () => {
    const callLog: string[] = [];
    const dependencies = makeDependencies(callLog, {
      tryAcquireLock: vi.fn(() => Promise.resolve(false)),
    });

    await runManagePushChannels(dependencies);

    expect(callLog).toEqual([]);
    expect(dependencies.selectEligibleCalendars).not.toHaveBeenCalled();
  });

  it("skips only the scopes another replica already locked", async () => {
    const callLog: string[] = [];
    const dependencies = makeDependencies(callLog, {
      selectEligibleCalendars: vi.fn(() => Promise.resolve([
        makeCalendar({ calendarId: "cal-locked", externalCalendarId: "external-locked" }),
        makeCalendar({ calendarId: "cal-free", externalCalendarId: "external-free" }),
      ])),
      tryAcquireLock: vi.fn((key: string) => Promise.resolve(!key.includes("cal-locked"))),
    });

    await runManagePushChannels(dependencies);

    expect(dependencies.registrar.register).toHaveBeenCalledOnce();
    expect(observedFields(dependencies.observe)["push_channel.lock_contention"]).toBe(1);
  });

  it("re-reads the row inside the lock and skips a scope that no longer needs work", async () => {
    const callLog: string[] = [];
    const expiring = makeChannel({ expiresAt: new Date(NOW.getTime() + HOUR_MS) });
    const dependencies = makeDependencies(callLog, {
      readChannel: vi.fn(() => Promise.resolve(makeChannel({
        expiresAt: new Date(NOW.getTime() + 6 * 24 * HOUR_MS),
      }))),
      selectChannels: vi.fn(() => Promise.resolve([expiring])),
    });

    await runManagePushChannels(dependencies);

    expect(dependencies.registrar.renew).not.toHaveBeenCalled();
    expect(dependencies.registrar.register).not.toHaveBeenCalled();
    expect(dependencies.registrar.deregister).not.toHaveBeenCalled();
  });
});

describe("runManagePushChannels teardown", () => {
  it("tears down a channel whose user downgraded to free", async () => {
    const callLog: string[] = [];
    const dependencies = makeDependencies(callLog, {
      resolvePlan: vi.fn(() => Promise.resolve("free" as const)),
      selectChannels: vi.fn(() => Promise.resolve([makeChannel()])),
    });

    await runManagePushChannels(dependencies);

    expect(dependencies.registrar.deregister).toHaveBeenCalledOnce();
    const teardown = dependencies.updateChannel.mock.calls.at(-1) as [string, Record<string, unknown>];
    expect(teardown[1].state).toBe("removed");
    expect(dependencies.registrar.register).not.toHaveBeenCalled();
  });

  it("counts the calendars it withheld from free users", async () => {
    const callLog: string[] = [];
    const dependencies = makeDependencies(callLog, {
      resolvePlan: vi.fn(() => Promise.resolve("free" as const)),
      selectEligibleCalendars: vi.fn(() => Promise.resolve([
        makeCalendar({ calendarId: "cal-1", externalCalendarId: "external-1" }),
        makeCalendar({ calendarId: "cal-2", externalCalendarId: "external-2" }),
      ])),
    });

    await runManagePushChannels(dependencies);

    expect(observedFields(dependencies.observe)["push_channel.skipped_free_count"]).toBe(2);
    expect(dependencies.registrar.register).not.toHaveBeenCalled();
  });

  it("tears down and never re-registers an account that needs reauthentication", async () => {
    const callLog: string[] = [];
    const dependencies = makeDependencies(callLog, {
      selectChannels: vi.fn(() => Promise.resolve([makeChannel()])),
      selectEligibleCalendars: vi.fn(() => Promise.resolve([
        makeCalendar({ needsReauthentication: true }),
      ])),
    });

    await runManagePushChannels(dependencies);

    expect(dependencies.registrar.deregister).toHaveBeenCalledOnce();
    expect(dependencies.registrar.register).not.toHaveBeenCalled();
  });

  it("fails a row with no provider channel id without contacting the provider", async () => {
    const callLog: string[] = [];
    const orphan = makeChannel({
      expiresAt: null,
      providerChannelId: null,
      providerResourceId: null,
      state: "registering",
      updatedAt: new Date(NOW.getTime() - 24 * HOUR_MS),
    });
    const dependencies = makeDependencies(callLog, {
      readChannel: vi.fn(() => Promise.resolve(orphan)),
      resolvePlan: vi.fn(() => Promise.resolve("free" as const)),
      selectChannels: vi.fn(() => Promise.resolve([orphan])),
    });

    await runManagePushChannels(dependencies);

    expect(dependencies.registrar.deregister).not.toHaveBeenCalled();
    const teardown = dependencies.updateChannel.mock.calls.at(-1) as [string, Record<string, unknown>];
    expect(teardown[1].state).toBe("failed");
  });
});

describe("runManagePushChannels drift reconciliation", () => {
  it("deletes an Outlook subscription pointing at us with no matching row", async () => {
    const callLog: string[] = [];
    const outlookRegistrar = makeRegistrar(callLog, {
      list: vi.fn(() => {
        callLog.push("registrar.list");
        return Promise.resolve([
          {
            expiresAt: new Date(NOW.getTime() + 6 * 24 * HOUR_MS),
            notificationUrl: `${WEBHOOK_URL}/api/webhook/outlook`,
            providerChannelId: "graph-orphan-1",
            providerResourceId: null,
            resourcePath: "/users/u1/calendars/c1/events",
          },
        ]);
      }),
      provider: "outlook",
      renewalMode: "extend",
      supportsList: true,
    });
    const dependencies = makeDependencies(callLog, {
      registrar: outlookRegistrar,
      resolveRegistrar: vi.fn(() => outlookRegistrar),
      selectChannels: vi.fn(() => Promise.resolve([])),
      selectEligibleCalendars: vi.fn(() => Promise.resolve([
        makeCalendar({ provider: "outlook" }),
      ])),
    });

    await runManagePushChannels(dependencies);

    expect(callLog).toContain("registrar.list");
    expect(outlookRegistrar.deregister).toHaveBeenCalled();
    expect(observedFields(dependencies.observe)["push_channel.drift_unknown_at_provider"])
      .toBe(1);
  });

  it("never asks Google for a channel list", async () => {
    const callLog: string[] = [];
    const dependencies = makeDependencies(callLog);

    await runManagePushChannels(dependencies);

    expect(callLog).not.toContain("registrar.list");
    expect(dependencies.registrar.list).not.toHaveBeenCalled();
  });

  it("never deletes a subscription registered during the same tick", async () => {
    const callLog: string[] = [];
    const outlookRegistrar = makeRegistrar(callLog, {
      list: vi.fn(() => {
        callLog.push("registrar.list");
        return Promise.resolve([
          {
            expiresAt: new Date(NOW.getTime() + 2 * 24 * HOUR_MS),
            notificationUrl: `${WEBHOOK_URL}/api/webhook/outlook`,
            providerChannelId: "graph-sub-fresh",
            providerResourceId: null,
            resourcePath: "/users/u1/calendars/external-1/events",
          },
        ]);
      }),
      provider: "outlook",
      register: vi.fn(() => {
        callLog.push("registrar.register");
        return Promise.resolve(makeRegistration({
          providerChannelId: "graph-sub-fresh",
          providerResourceId: null,
        }));
      }),
      renewalMode: "extend",
      supportsList: true,
    });
    const dependencies = makeDependencies(callLog, {
      registrar: outlookRegistrar,
      resolveRegistrar: vi.fn(() => outlookRegistrar),
      selectChannels: vi.fn(() => Promise.resolve([])),
      selectEligibleCalendars: vi.fn(() => Promise.resolve([
        makeCalendar({ provider: "outlook" }),
      ])),
    });

    await runManagePushChannels(dependencies);

    expect(callLog).toContain("registrar.register");
    expect(outlookRegistrar.deregister).not.toHaveBeenCalled();
    expect(observedFields(dependencies.observe)["push_channel.drift_unknown_at_provider"])
      .toBe(0);
  });

  it("leaves a sibling deployment's subscription alone when its url extends ours", async () => {
    const callLog: string[] = [];
    const outlookRegistrar = makeRegistrar(callLog, {
      list: vi.fn(() => {
        callLog.push("registrar.list");
        return Promise.resolve([
          {
            expiresAt: new Date(NOW.getTime() + 2 * 24 * HOUR_MS),
            notificationUrl: `${WEBHOOK_URL}/api/webhook/outlook-staging`,
            providerChannelId: "graph-sibling-1",
            providerResourceId: null,
            resourcePath: "/users/u1/calendars/c1/events",
          },
        ]);
      }),
      provider: "outlook",
      renewalMode: "extend",
      supportsList: true,
    });
    const dependencies = makeDependencies(callLog, {
      registrar: outlookRegistrar,
      resolveRegistrar: vi.fn(() => outlookRegistrar),
      selectChannels: vi.fn(() => Promise.resolve([])),
      selectEligibleCalendars: vi.fn(() => Promise.resolve([
        makeCalendar({ provider: "outlook" }),
      ])),
    });

    await runManagePushChannels(dependencies);

    expect(callLog).toContain("registrar.list");
    expect(outlookRegistrar.deregister).not.toHaveBeenCalled();
    expect(observedFields(dependencies.observe)["push_channel.drift_unknown_at_provider"])
      .toBe(0);
  });

  it("never asks a provider for a list on behalf of a dead grant", async () => {
    const callLog: string[] = [];
    const outlookRegistrar = makeRegistrar(callLog, {
      provider: "outlook",
      renewalMode: "extend",
      supportsList: true,
    });
    const dependencies = makeDependencies(callLog, {
      registrar: outlookRegistrar,
      resolveRegistrar: vi.fn(() => outlookRegistrar),
      selectChannels: vi.fn(() => Promise.resolve([])),
      selectEligibleCalendars: vi.fn(() => Promise.resolve([
        makeCalendar({ needsReauthentication: true, provider: "outlook" }),
      ])),
    });

    await runManagePushChannels(dependencies);

    expect(outlookRegistrar.list).not.toHaveBeenCalled();
    expect(dependencies.createRegistrarContext).not.toHaveBeenCalled();
  });
});

describe("runManagePushChannels renewal against a vanished subscription", () => {
  it("re-registers rather than backing off when the provider reports it gone", async () => {
    const callLog: string[] = [];
    const gone = Object.assign(
      new Error("Microsoft Graph subscription renew failed with status 404"),
      { channelGone: true },
    );
    const outlookRegistrar = makeRegistrar(callLog, {
      provider: "outlook",
      register: vi.fn(() => {
        callLog.push("registrar.register");
        return Promise.resolve(makeRegistration({
          providerChannelId: "graph-subscription-2",
          providerResourceId: null,
        }));
      }),
      renew: vi.fn(() => {
        callLog.push("registrar.renew");
        return Promise.reject(gone);
      }),
      renewalMode: "extend",
      supportsList: true,
    });
    const expiring = makeChannel({
      expiresAt: new Date(NOW.getTime() + HOUR_MS),
      provider: "outlook",
      providerChannelId: "graph-subscription-1",
      providerResourceId: null,
    });
    const dependencies = makeDependencies(callLog, {
      readChannel: vi.fn(() => Promise.resolve(expiring)),
      registrar: outlookRegistrar,
      resolveRegistrar: vi.fn(() => outlookRegistrar),
      selectChannels: vi.fn(() => Promise.resolve([expiring])),
      selectEligibleCalendars: vi.fn(() => Promise.resolve([
        makeCalendar({ provider: "outlook" }),
      ])),
    });

    await runManagePushChannels(dependencies);

    expect(callLog).toContain("registrar.register");
    const activation = dependencies.updateChannel.mock.calls.at(-1) as [
      string,
      Record<string, unknown>,
    ];
    expect(activation[1].state).toBe("active");
    expect(activation[1].providerChannelId).toBe("graph-subscription-2");
    expect(observedFields(dependencies.observe)["push_channel.failed_count"]).toBe(0);
  });

  it("keeps an activated Google renewal active when stopping the old channel fails", async () => {
    const callLog: string[] = [];
    const registrar = makeRegistrar(callLog, {
      deregister: vi.fn(() => {
        callLog.push("registrar.deregister");
        return Promise.reject(new Error("Google channel stop failed with status 500"));
      }),
      renew: vi.fn(() => {
        callLog.push("registrar.renew");
        return Promise.resolve(makeRegistration());
      }),
    });
    const expiring = makeChannel({ expiresAt: new Date(NOW.getTime() + HOUR_MS) });
    const dependencies = makeDependencies(callLog, {
      readChannel: vi.fn(() => Promise.resolve(expiring)),
      registrar,
      resolveRegistrar: vi.fn(() => registrar),
      selectChannels: vi.fn(() => Promise.resolve([expiring])),
    });

    await runManagePushChannels(dependencies);

    const activation = dependencies.updateChannel.mock.calls.at(-1) as [
      string,
      Record<string, unknown>,
    ];
    expect(activation[1].state).toBe("active");
    expect(observedFields(dependencies.observe)["push_channel.renewed_count"]).toBe(1);
    expect(observedFields(dependencies.observe)["push_channel.failed_count"]).toBe(0);
    expect(dependencies.recordError).toHaveBeenCalledWith(
      expect.any(Error),
      "webhook-deregistration-failed",
    );
  });
});

describe("runManagePushChannels error surfacing", () => {
  it("records an error when an action rejects outside its own handler", async () => {
    const callLog: string[] = [];
    const dependencies = makeDependencies(callLog, {
      insertChannel: vi.fn(() => Promise.reject(new Error("duplicate key value"))),
    });

    await expect(runManagePushChannels(dependencies)).resolves.toBeUndefined();

    expect(dependencies.recordError).toHaveBeenCalledWith(
      expect.any(Error),
      "webhook-channel-action-failed",
    );
  });

  it("reports an unresolvable plan without abandoning the rest of the tick", async () => {
    const callLog: string[] = [];
    const dependencies = makeDependencies(callLog, {
      resolvePlan: vi.fn((userId: string) => {
        if (userId === "user-broken") {
          return Promise.reject(new Error("connection reset"));
        }
        return Promise.resolve("pro" as const);
      }),
      selectEligibleCalendars: vi.fn(() => Promise.resolve([
        makeCalendar({
          calendarId: "cal-broken",
          externalCalendarId: "external-broken",
          userId: "user-broken",
        }),
        makeCalendar({ calendarId: "cal-healthy", externalCalendarId: "external-healthy" }),
      ])),
    });

    await runManagePushChannels(dependencies);

    expect(dependencies.registrar.register).toHaveBeenCalledOnce();
    expect(dependencies.recordError).toHaveBeenCalledWith(
      expect.any(Error),
      "webhook-plan-unresolvable",
    );
    expect(observedFields(dependencies.observe)["push_channel.plan_error_count"]).toBe(1);
  });
});
