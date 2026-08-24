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
const WEBHOOK_URL = "https://www.example.com";
const CORRELATION_ID = "correlation-from-webhook";
const OK_STATUS = 200;
const WOKEN_CALENDAR_IDS = ["cal-1", "cal-2"];

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

const handshakeRequest = (): Request => new Request(
  "https://www.example.com/api/webhook/outlook?validationToken=echo-me",
  { method: "POST" },
);

const makeDependencies = (overrides: Record<string, unknown> = {}) => ({
  claimDelivery: vi.fn((_deliveryKey: string) => Promise.resolve(true)),
  claimPushAdmission: vi.fn((_input: { channelKey: string | null; provider: string }) =>
    Promise.resolve(true)),
  findChannel: vi.fn(() => Promise.resolve(makeChannel())),
  generateCorrelationId: vi.fn(() => CORRELATION_ID),
  isUnknownChannelCached: vi.fn(() => Promise.resolve(false)),
  markPendingIngest: vi.fn(() => Promise.resolve()),
  observe: vi.fn(),
  recordError: vi.fn(),
  recordNotificationReceived: vi.fn(),
  recordVerified: vi.fn(() => Promise.resolve()),
  rememberUnknownChannel: vi.fn(
    (_provider: string, _channelKey: string, _ttlSeconds: number) => Promise.resolve(),
  ),
  resolveAffectedCalendarIds: vi.fn(() => Promise.resolve([...WOKEN_CALENDAR_IDS])),
  signalPendingIngest: vi.fn((_calendarIds: string[]) => Promise.resolve()),
  verifySecret: vi.fn((presented: string, storedHash: string) =>
    presented === GOOGLE_SECRET && storedHash === GOOGLE_SECRET_HASH),
  webhookPublicUrl: WEBHOOK_URL,
  ...overrides,
});

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

describe("push webhook drain signal", () => {
  it("signals exactly the calendars it marked pending", async () => {
    const dependencies = makeDependencies();

    await handleGooglePushWebhook({ request: googleRequest() }, dependencies);

    expect(dependencies.markPendingIngest).toHaveBeenCalledWith(
      WOKEN_CALENDAR_IDS,
      CORRELATION_ID,
    );
    expect(dependencies.signalPendingIngest).toHaveBeenCalledWith(WOKEN_CALENDAR_IDS);
  });

  it("signals nothing for a validation handshake echo", async () => {
    const dependencies = makeDependencies();

    const response = await handleOutlookPushWebhook(
      { request: handshakeRequest() },
      dependencies,
    );

    expect(await response.text()).toBe("echo-me");
    expect(dependencies.signalPendingIngest).not.toHaveBeenCalled();
  });

  it("still accepts the delivery when signalling fails", async () => {
    const dependencies = makeDependencies({
      signalPendingIngest: vi.fn(() => Promise.reject(new Error("redis down"))),
    });

    const response = await handleGooglePushWebhook(
      { request: googleRequest() },
      dependencies,
    );

    expect(response.status).toBe(OK_STATUS);
    expect(dependencies.markPendingIngest).toHaveBeenCalledWith(
      WOKEN_CALENDAR_IDS,
      CORRELATION_ID,
    );
    expect(dependencies.signalPendingIngest).toHaveBeenCalledWith(WOKEN_CALENDAR_IDS);
  });
});
