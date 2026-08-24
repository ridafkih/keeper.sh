import { describe, expect, it } from "vitest";
import {
  planPushChannelActions,
  type EligibleSourceCalendar,
  type PushChannelAction,
  type StoredPushChannel,
} from "../../../src/core/source/push-channel";
import { resolvePushRegistrar } from "../../../src/core/source/push-registry";

const NOW = new Date("2026-08-12T00:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;
const WEBHOOK_URL = "https://www.example.com";

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
  providerChannelId: "provider-channel-1",
  providerResourceId: "provider-resource-1",
  reauthorizeRequestedAt: null,
  resourcePath: "/calendars/external-1/events",
  secretHash: "a".repeat(64),
  state: "active",
  updatedAt: NOW,
  userId: "user-1",
  verifiedAt: NOW,
  ...overrides,
});

const alwaysPro = (): Promise<"pro"> => Promise.resolve("pro");
const alwaysFree = (): Promise<"free"> => Promise.resolve("free");

const discardedPlanErrors: unknown[] = [];
const discardPlanError = (_userId: string, error: unknown): void => {
  discardedPlanErrors.push(error);
};

const plan = (
  input: {
    calendars?: EligibleSourceCalendar[];
    channels?: StoredPushChannel[];
    now?: Date;
    onPlanError?: (userId: string, error: unknown) => void;
    resolvePlan?: (userId: string) => Promise<"free" | "pro">;
    webhookPublicUrl?: string | null;
  } = {},
): Promise<PushChannelAction[]> => planPushChannelActions({
  calendars: [makeCalendar()],
  channels: [],
  now: NOW,
  onPlanError: discardPlanError,
  resolvePlan: alwaysPro,
  webhookPublicUrl: WEBHOOK_URL,
  ...input,
});

describe("planPushChannelActions eligibility", () => {
  it("plans nothing when no public webhook url is configured", async () => {
    await expect(plan({ webhookPublicUrl: null })).resolves.toEqual([]);
  });

  it("registers for pro users and skips free users", async () => {
    const proActions = await plan({ resolvePlan: alwaysPro });
    expect(proActions.map((action) => action.type)).toEqual(["register"]);

    const freeActions = await plan({ resolvePlan: alwaysFree });
    expect(freeActions).toEqual([]);
  });

  it("skips accounts that need reauthentication", async () => {
    await expect(plan({
      calendars: [makeCalendar({ needsReauthentication: true })],
    })).resolves.toEqual([]);
  });

  it("skips calendars without an external calendar id for both providers", async () => {
    await expect(plan({
      calendars: [
        makeCalendar({ externalCalendarId: null }),
        makeCalendar({
          calendarId: "cal-2",
          externalCalendarId: null,
          provider: "outlook",
        }),
      ],
    })).resolves.toEqual([]);
  });

  it("skips only the providers that need a provider account id when it is absent", async () => {
    const actions = await plan({
      calendars: [
        makeCalendar({ providerAccountId: null }),
        makeCalendar({
          calendarId: "cal-2",
          provider: "outlook",
          providerAccountId: null,
        }),
      ],
    });

    expect(actions.map((action) => [action.provider, action.type])).toEqual([
      ["google", "register"],
    ]);
  });

  it("deregisters a channel whose calendar became disabled or lost pull", async () => {
    const disabled = await plan({
      calendars: [makeCalendar({ disabled: true })],
      channels: [makeChannel()],
    });
    expect(disabled.map((action) => action.type)).toEqual(["deregister"]);

    const noPull = await plan({
      calendars: [makeCalendar({ capabilities: ["push"] })],
      channels: [makeChannel()],
    });
    expect(noPull.map((action) => action.type)).toEqual(["deregister"]);
  });

  it("deregisters a channel whose calendar disappeared entirely", async () => {
    const actions = await plan({ calendars: [], channels: [makeChannel()] });
    expect(actions.map((action) => action.type)).toEqual(["deregister"]);
  });

  it("does not register a second channel for a live scope", async () => {
    for (const state of ["registering", "active", "degraded"] as const) {
      const actions = await plan({ channels: [makeChannel({ state })] });
      expect(actions.filter((action) => action.type === "register")).toEqual([]);
    }
  });

  it("registers again once the previous channel is removed or failed", async () => {
    for (const state of ["removed", "failed"] as const) {
      const actions = await plan({ channels: [makeChannel({ state })] });
      expect(actions.map((action) => action.type)).toEqual(["register"]);
    }
  });

  it("reports rather than defaulting when a plan cannot be resolved", async () => {
    const planErrors: { message: string; userId: string }[] = [];

    const actions = await plan({
      onPlanError: (userId, error) => {
        planErrors.push({ message: String((error as Error).message), userId });
      },
      resolvePlan: () => Promise.reject(new Error("connection reset")),
    });

    expect(actions).toEqual([]);
    expect(planErrors).toHaveLength(1);
    expect(planErrors[0]?.userId).toBe("user-1");
    expect(planErrors[0]?.message).toMatch(/Unable to resolve user plan/);
  });

  it("confines an unresolvable plan to that user and still plans for everyone else", async () => {
    const planErrors: string[] = [];

    const actions = await plan({
      calendars: [
        makeCalendar({
          calendarId: "cal-broken",
          externalCalendarId: "e-broken",
          userId: "user-broken",
        }),
        makeCalendar({
          calendarId: "cal-healthy",
          externalCalendarId: "e-healthy",
          userId: "user-healthy",
        }),
        makeCalendar({
          calendarId: "cal-renew",
          externalCalendarId: "e-renew",
          userId: "user-healthy",
        }),
      ],
      channels: [
        makeChannel({
          calendarId: "cal-renew",
          expiresAt: new Date(NOW.getTime() + HOUR_MS),
          id: "channel-renew",
          userId: "user-healthy",
        }),
      ],
      onPlanError: (userId) => {
        planErrors.push(userId);
      },
      resolvePlan: (userId) => {
        if (userId === "user-broken") {
          return Promise.reject(new Error("connection reset"));
        }
        return Promise.resolve("pro");
      },
    });

    expect(planErrors).toEqual(["user-broken"]);
    expect(actions.map((action) => action.type).toSorted()).toEqual(["register", "renew"]);
    expect(actions.some((action) => action.scope.kind === "calendar"
      && action.scope.calendarId === "cal-broken")).toBe(false);
  });
});

describe("planPushChannelActions registration recovery", () => {
  it("re-registers a live row that never reached activation", async () => {
    const neverActivated = makeChannel({
      expiresAt: null,
      nextAttemptAt: new Date(NOW.getTime() - HOUR_MS),
      providerChannelId: null,
      providerResourceId: null,
      resourcePath: null,
      state: "degraded",
      verifiedAt: null,
    });

    const actions = await plan({ channels: [neverActivated] });

    expect(actions.map((action) => action.type)).toEqual(["register"]);
  });

  it("waits out the registration backoff before retrying", async () => {
    const backingOff = makeChannel({
      expiresAt: null,
      nextAttemptAt: new Date(NOW.getTime() + HOUR_MS),
      providerChannelId: null,
      providerResourceId: null,
      resourcePath: null,
      state: "registering",
      updatedAt: new Date(NOW.getTime() - 24 * HOUR_MS),
      verifiedAt: null,
    });

    await expect(plan({ channels: [backingOff] })).resolves.toEqual([]);
  });

  it("retries a registering row once its backoff has elapsed", async () => {
    const due = makeChannel({
      expiresAt: null,
      nextAttemptAt: new Date(NOW.getTime() - 1000),
      providerChannelId: null,
      providerResourceId: null,
      resourcePath: null,
      state: "registering",
      updatedAt: new Date(NOW.getTime() - 1000),
      verifiedAt: null,
    });

    const actions = await plan({ channels: [due] });

    expect(actions.map((action) => action.type)).toEqual(["register"]);
  });

  it("still renews an activated row that later degraded", async () => {
    const degradedButActivated = makeChannel({
      expiresAt: new Date(NOW.getTime() + HOUR_MS),
      state: "degraded",
    });

    const actions = await plan({ channels: [degradedButActivated] });

    expect(actions.map((action) => action.type)).toEqual(["renew"]);
  });
});

describe("planPushChannelActions scoping", () => {
  it("plans one per-calendar scope per Google calendar in an account", async () => {
    const actions = await plan({
      calendars: [
        makeCalendar({ calendarId: "cal-1", externalCalendarId: "external-1" }),
        makeCalendar({ calendarId: "cal-2", externalCalendarId: "external-2" }),
        makeCalendar({ calendarId: "cal-3", externalCalendarId: "external-3" }),
      ],
    });

    expect(actions).toHaveLength(3);
    for (const action of actions) {
      expect(action.type).toBe("register");
      expect(action.scope.kind).toBe("calendar");
    }
    expect(actions.map((action) => action.scope.kind === "calendar" && action.scope.calendarId))
      .toEqual(["cal-1", "cal-2", "cal-3"]);
  });

  it("plans one per-calendar scope per Outlook calendar in an account", async () => {
    const actions = await plan({
      calendars: [
        makeCalendar({ calendarId: "cal-1", externalCalendarId: "external-1", provider: "outlook" }),
        makeCalendar({ calendarId: "cal-2", externalCalendarId: "external-2", provider: "outlook" }),
        makeCalendar({ calendarId: "cal-3", externalCalendarId: "external-3", provider: "outlook" }),
      ],
    });

    expect(actions).toHaveLength(3);
    for (const action of actions) {
      expect(action.type).toBe("register");
      expect(action.scope.kind).toBe("calendar");
    }
  });

  it("keeps the Google recreate and Outlook extend renewal semantics apart", async () => {
    const googleRegistrar = resolvePushRegistrar("google");
    const outlookRegistrar = resolvePushRegistrar("outlook");
    if (!googleRegistrar || !outlookRegistrar) {
      throw new Error("expected registrars for google and outlook");
    }

    const [googleRenewal] = await plan({
      channels: [makeChannel({
        expiresAt: new Date(NOW.getTime() + HOUR_MS),
        providerChannelId: "google-channel-1",
        providerResourceId: "google-resource-1",
      })],
    });
    const [outlookRenewal] = await plan({
      calendars: [makeCalendar({ provider: "outlook" })],
      channels: [makeChannel({
        expiresAt: new Date(NOW.getTime() + HOUR_MS),
        provider: "outlook",
        providerChannelId: "graph-subscription-1",
        providerResourceId: null,
      })],
    });

    expect(googleRegistrar.renewalMode).toBe("recreate");
    expect(outlookRegistrar.renewalMode).toBe("extend");
    expect(googleRegistrar.supportsList).toBe(false);
    expect(outlookRegistrar.supportsList).toBe(true);

    expect(googleRenewal).toMatchObject({
      previousProviderChannelId: "google-channel-1",
      previousProviderResourceId: "google-resource-1",
      renewalMode: "recreate",
      type: "renew",
    });
    expect(outlookRenewal).toMatchObject({
      previousProviderChannelId: "graph-subscription-1",
      renewalMode: "extend",
      type: "renew",
    });
  });
});

describe("planPushChannelActions expiry staggering", () => {
  it("spreads requested expirations deterministically across the stagger period", async () => {
    const registrar = resolvePushRegistrar("google");
    if (!registrar) {
      throw new Error("expected a google registrar");
    }
    const staggerPeriodMs = registrar.maxLifetimeMs / 4;

    const calendars = Array.from({ length: 200 }, (_unused, index) => makeCalendar({
      calendarId: `cal-${index}`,
      externalCalendarId: `external-${index}`,
    }));

    const first = await plan({ calendars });
    const second = await plan({ calendars });

    const timestamps = first.map((action) => action.requestedExpiresAt.getTime());
    expect(Math.max(...timestamps) - Math.min(...timestamps))
      .toBeGreaterThan(staggerPeriodMs / 2);
    expect(Math.max(...timestamps))
      .toBeLessThanOrEqual(NOW.getTime() + registrar.maxLifetimeMs);
    expect(second.map((action) => action.requestedExpiresAt.getTime()))
      .toEqual(timestamps);
  });

  it("renews an Outlook subscription due in 20 hours but not one due in 72 hours", async () => {
    const soon = await plan({
      calendars: [makeCalendar({ provider: "outlook" })],
      channels: [makeChannel({
        expiresAt: new Date(NOW.getTime() + 20 * HOUR_MS),
        provider: "outlook",
      })],
    });
    const later = await plan({
      calendars: [makeCalendar({ provider: "outlook" })],
      channels: [makeChannel({
        expiresAt: new Date(NOW.getTime() + 72 * HOUR_MS),
        provider: "outlook",
      })],
    });

    expect(soon.map((action) => action.type)).toEqual(["renew"]);
    expect(later).toEqual([]);
  });

  it("renews immediately when the provider asked for reauthorization", async () => {
    const actions = await plan({
      calendars: [makeCalendar({ provider: "outlook" })],
      channels: [makeChannel({
        expiresAt: new Date(NOW.getTime() + 72 * HOUR_MS),
        provider: "outlook",
        reauthorizeRequestedAt: NOW,
      })],
    });

    expect(actions.map((action) => action.type)).toEqual(["renew"]);
  });
});
