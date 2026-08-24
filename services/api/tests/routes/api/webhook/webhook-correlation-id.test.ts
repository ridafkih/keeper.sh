import { beforeAll, describe, expect, it, vi } from "vitest";
import type { StoredPushChannel } from "@keeper.sh/calendar";
import type { handleGooglePushWebhook as handleGooglePushWebhookFn } from "../../../../src/routes/api/webhook/google";
import type { handleOutlookPushWebhook as handleOutlookPushWebhookFn } from "../../../../src/routes/api/webhook/outlook";

let handleGooglePushWebhook: typeof handleGooglePushWebhookFn = () =>
  Promise.reject(new Error("Module not loaded"));
let handleOutlookPushWebhook: typeof handleOutlookPushWebhookFn = () =>
  Promise.reject(new Error("Module not loaded"));

const NOW = new Date("2026-08-12T00:00:00.000Z");
const GOOGLE_SECRET = "b".repeat(64);
const GOOGLE_SECRET_HASH = "hash-of-b";
const GOOGLE_CHANNEL_KEY = "3f1b0e5a-1111-4f2a-9c22-000000000001";
const OUTLOOK_SECRET = "c".repeat(64);
const OUTLOOK_SECRET_HASH = "hash-of-c";
const OUTLOOK_CHANNEL_KEY = "sub-1";
const WEBHOOK_URL = "https://www.example.com";
const MINTED_CORRELATION_ID = "correlation-from-webhook";

const makeChannel = (
  overrides: Partial<StoredPushChannel> = {},
): StoredPushChannel => ({
  accountId: "account-1",
  calendarId: "cal-1",
  createdAt: NOW,
  expiresAt: new Date(NOW.getTime() + 86_400_000),
  failureCount: 0,
  id: "channel-1",
  lastFailureAt: null,
  lastNotificationAt: null,
  nextAttemptAt: null,
  provider: "google",
  providerChannelId: GOOGLE_CHANNEL_KEY,
  providerResourceId: "google-resource-1",
  reauthorizeRequestedAt: null,
  resourcePath: "/calendars/external-1/events",
  secretHash: GOOGLE_SECRET_HASH,
  state: "active",
  updatedAt: NOW,
  userId: "user-1",
  verifiedAt: null,
  ...overrides,
});

const googleRequest = (): Request => new Request(
  "https://www.example.com/api/webhook/google",
  {
    headers: {
      "x-goog-channel-id": GOOGLE_CHANNEL_KEY,
      "x-goog-channel-token": GOOGLE_SECRET,
      "x-goog-message-number": "7",
      "x-goog-resource-id": "google-resource-1",
      "x-goog-resource-state": "exists",
    },
    method: "POST",
  },
);

const outlookRequest = (): Request => new Request(
  "https://www.example.com/api/webhook/outlook",
  {
    body: JSON.stringify({
      value: [{
        changeType: "updated",
        clientState: OUTLOOK_SECRET,
        resource: "/users/u1/calendars/cal-999/events/e1",
        resourceData: { "@odata.type": "#Microsoft.Graph.Event", id: "event-1" },
        subscriptionExpirationDateTime: "2026-08-19T00:00:00.000Z",
        subscriptionId: OUTLOOK_CHANNEL_KEY,
        tenantId: "tenant-1",
      }],
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  },
);

const makeDependencies = (overrides: Record<string, unknown> = {}) => ({
  claimDelivery: vi.fn((_deliveryKey: string) => Promise.resolve(true)),
  claimPushAdmission: vi.fn((_input: { channelKey: string | null; provider: string }) =>
    Promise.resolve(true)),
  findChannel: vi.fn(() => Promise.resolve(makeChannel())),
  generateCorrelationId: vi.fn(() => MINTED_CORRELATION_ID),
  isUnknownChannelCached: vi.fn(() => Promise.resolve(false)),
  markPendingIngest: vi.fn(() => Promise.resolve()),
  observe: vi.fn(),
  recordNotificationReceived: vi.fn(),
  recordVerified: vi.fn(() => Promise.resolve()),
  rememberUnknownChannel: vi.fn(
    (_provider: string, _channelKey: string, _ttlSeconds: number) => Promise.resolve(),
  ),
  resolveAffectedCalendarIds: vi.fn((channel: StoredPushChannel) =>
    Promise.resolve([channel.calendarId].filter((id) => id !== null))),
  verifySecret: vi.fn((presented: string, storedHash: string) =>
    (presented === GOOGLE_SECRET && storedHash === GOOGLE_SECRET_HASH)
    || (presented === OUTLOOK_SECRET && storedHash === OUTLOOK_SECRET_HASH)),
  webhookPublicUrl: WEBHOOK_URL,
  ...overrides,
});

const observedFields = (
  observe: ReturnType<typeof vi.fn>,
): Record<string, unknown> => {
  const merged: Record<string, unknown> = {};
  for (const call of observe.mock.calls) {
    Object.assign(merged, call[0]);
  }
  return merged;
};

vi.mock("../../../../src/utils/middleware", () => ({
  withAuth: (handler: unknown) => handler,
  withWideEvent: (handler: unknown) => handler,
}));
vi.mock("../../../../src/context", () => ({
  database: {},
  premiumService: {},
  redis: {},
}));
vi.mock("../../../../src/env", () => ({ default: {} }));
vi.mock("../../../../src/utils/logging", () => ({
  context: (callback: () => unknown) => callback(),
  widelog: {
    append: () => null,
    error: () => null,
    errorFields: () => null,
    flush: () => null,
    set: () => null,
    setFields: () => null,
  },
}));

beforeAll(async () => {
  ({ handleGooglePushWebhook } = await import("../../../../src/routes/api/webhook/google"));
  ({ handleOutlookPushWebhook } = await import("../../../../src/routes/api/webhook/outlook"));
});

describe("google push webhook correlation id", () => {
  it("stamps the minted id on its wide event", async () => {
    const dependencies = makeDependencies();

    await handleGooglePushWebhook({ request: googleRequest() }, dependencies);

    expect(observedFields(dependencies.observe)["correlation.id"]).toBe(
      MINTED_CORRELATION_ID,
    );
  });

  it("hands the minted id to the pending ingest queue entry", async () => {
    const dependencies = makeDependencies();

    await handleGooglePushWebhook({ request: googleRequest() }, dependencies);

    expect(dependencies.markPendingIngest).toHaveBeenCalledWith(
      ["cal-1"],
      MINTED_CORRELATION_ID,
    );
  });
});

describe("outlook push webhook correlation id", () => {
  it("hands the minted id to the pending ingest queue entry", async () => {
    const dependencies = makeDependencies({
      findChannel: vi.fn(() => Promise.resolve(makeChannel({
        provider: "outlook",
        providerChannelId: OUTLOOK_CHANNEL_KEY,
        providerResourceId: null,
        secretHash: OUTLOOK_SECRET_HASH,
      }))),
    });

    await handleOutlookPushWebhook({ request: outlookRequest() }, dependencies);

    expect(dependencies.markPendingIngest).toHaveBeenCalledWith(
      ["cal-1"],
      MINTED_CORRELATION_ID,
    );
    expect(observedFields(dependencies.observe)["correlation.id"]).toBe(
      MINTED_CORRELATION_ID,
    );
  });
});
