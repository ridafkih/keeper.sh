import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredPushChannel } from "@keeper.sh/calendar";
import type { handleGooglePushWebhook as handleGooglePushWebhookFn } from "../../../../src/routes/api/webhook/google";

const COLD_IMPORT_TIMEOUT_MS = 30_000;

let handleGooglePushWebhook: typeof handleGooglePushWebhookFn = () =>
  Promise.reject(new Error("Module not loaded"));

const NOW = new Date("2026-08-12T00:00:00.000Z");
const SECRET = "b".repeat(64);
const SECRET_HASH = "hash-of-b";
const CHANNEL_KEY = "3f1b0e5a-1111-4f2a-9c22-000000000001";
const WEBHOOK_URL = "https://www.example.com";

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
  providerChannelId: CHANNEL_KEY,
  providerResourceId: "google-resource-1",
  reauthorizeRequestedAt: null,
  resourcePath: "/calendars/external-1/events",
  secretHash: SECRET_HASH,
  state: "active",
  updatedAt: NOW,
  userId: "user-1",
  verifiedAt: null,
  ...overrides,
});

const makeRequest = (
  headers: Record<string, string> = {},
  body: string | null = null,
): Request => new Request("https://www.example.com/api/webhook/google", {
  body,
  headers: {
    "x-goog-channel-id": CHANNEL_KEY,
    "x-goog-channel-token": SECRET,
    "x-goog-message-number": "7",
    "x-goog-resource-id": "google-resource-1",
    "x-goog-resource-state": "exists",
    ...headers,
  },
  method: "POST",
});

const streamingRequest = (callLog: string[], payload: string): Request => new Request(
  "https://www.example.com/api/webhook/google",
  {
    body: new ReadableStream<Uint8Array>({
      pull: (controller) => {
        callLog.push("body");
        controller.enqueue(new TextEncoder().encode(payload));
        controller.close();
      },
    }),
    duplex: "half",
    headers: {
      "x-goog-channel-id": CHANNEL_KEY,
      "x-goog-channel-token": SECRET,
      "x-goog-message-number": "7",
      "x-goog-resource-id": "google-resource-1",
      "x-goog-resource-state": "exists",
    },
    method: "POST",
  },
);

const makeDependencies = (overrides: Record<string, unknown> = {}) => ({
  claimDelivery: vi.fn((_deliveryKey: string) => Promise.resolve(true)),
  claimPushAdmission: vi.fn((_input: { channelKey: string | null; provider: string }) =>
    Promise.resolve(true)),
  findChannel: vi.fn(() => Promise.resolve(makeChannel())),
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
    presented === SECRET && storedHash === SECRET_HASH),
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
}, COLD_IMPORT_TIMEOUT_MS);

describe("handleGooglePushWebhook when push is unconfigured", () => {
  it("returns 501 and performs no work at all", async () => {
    const dependencies = makeDependencies({ webhookPublicUrl: null });

    const response = await handleGooglePushWebhook(
      { request: makeRequest() },
      dependencies,
    );

    expect(response.status).toBe(501);
    expect(dependencies.claimPushAdmission).not.toHaveBeenCalled();
    expect(dependencies.isUnknownChannelCached).not.toHaveBeenCalled();
    expect(dependencies.findChannel).not.toHaveBeenCalled();
    expect(dependencies.claimDelivery).not.toHaveBeenCalled();
    expect(dependencies.markPendingIngest).not.toHaveBeenCalled();
    expect(dependencies.recordVerified).not.toHaveBeenCalled();
  });
});

describe("handleGooglePushWebhook routing", () => {
  it("triggers only the calendar named by the stored channel row", async () => {
    const dependencies = makeDependencies();

    const response = await handleGooglePushWebhook(
      { request: makeRequest({}, JSON.stringify({ calendarId: "cal-999" })) },
      dependencies,
    );

    expect(response.status).toBe(200);
    expect(dependencies.markPendingIngest).toHaveBeenCalledOnce();
    expect(dependencies.markPendingIngest).toHaveBeenCalledWith(["cal-1"]);
    expect(dependencies.findChannel).toHaveBeenCalledWith("google", CHANNEL_KEY);
  });

  it("acknowledges the sync ping without triggering an ingest", async () => {
    const dependencies = makeDependencies();

    const response = await handleGooglePushWebhook(
      {
        request: makeRequest({
          "x-goog-message-number": "1",
          "x-goog-resource-state": "sync",
        }),
      },
      dependencies,
    );

    expect(response.status).toBe(200);
    expect(dependencies.recordVerified).toHaveBeenCalledOnce();
    expect(dependencies.recordVerified).toHaveBeenCalledWith("channel-1");
    expect(dependencies.markPendingIngest).not.toHaveBeenCalled();
  });
});

describe("handleGooglePushWebhook verification", () => {
  it("accepts a registering row on the token alone", async () => {
    const dependencies = makeDependencies({
      findChannel: vi.fn(() => Promise.resolve(makeChannel({
        providerResourceId: null,
        state: "registering",
      }))),
    });

    const response = await handleGooglePushWebhook(
      { request: makeRequest({ "x-goog-resource-id": "some-resource-we-never-recorded" }) },
      dependencies,
    );

    expect(response.status).toBe(200);
    expect(dependencies.markPendingIngest).toHaveBeenCalledWith(["cal-1"]);
    expect(observedFields(dependencies.observe)["webhook.channel_state"]).toBe("registering");
  });

  it("still enforces the resource id once it has been recorded", async () => {
    const dependencies = makeDependencies();

    const response = await handleGooglePushWebhook(
      { request: makeRequest({ "x-goog-resource-id": "a-different-resource" }) },
      dependencies,
    );

    expect(response.status).toBe(401);
    expect(dependencies.markPendingIngest).not.toHaveBeenCalled();
  });

  it("returns an indistinguishable 401 for an unknown channel and for a secret mismatch", async () => {
    const unknownDependencies = makeDependencies({
      findChannel: vi.fn(() => Promise.resolve(null)),
    });
    const mismatchDependencies = makeDependencies();

    const unknown = await handleGooglePushWebhook(
      { request: makeRequest() },
      unknownDependencies,
    );
    const mismatch = await handleGooglePushWebhook(
      { request: makeRequest({ "x-goog-channel-token": "c".repeat(64) }) },
      mismatchDependencies,
    );

    expect(unknown.status).toBe(401);
    expect(mismatch.status).toBe(401);
    expect(await unknown.text()).toBe(await mismatch.text());
    expect([...unknown.headers.entries()].toSorted())
      .toEqual([...mismatch.headers.entries()].toSorted());
    expect(unknownDependencies.markPendingIngest).not.toHaveBeenCalled();
    expect(mismatchDependencies.markPendingIngest).not.toHaveBeenCalled();
  });

  it("records which of the two rejections happened only on the wide event", async () => {
    const unknownDependencies = makeDependencies({
      findChannel: vi.fn(() => Promise.resolve(null)),
    });
    const mismatchDependencies = makeDependencies();

    await handleGooglePushWebhook({ request: makeRequest() }, unknownDependencies);
    await handleGooglePushWebhook(
      { request: makeRequest({ "x-goog-channel-token": "c".repeat(64) }) },
      mismatchDependencies,
    );

    expect(observedFields(unknownDependencies.observe)["webhook.reject_reason"])
      .toBe("unknown_channel");
    expect(observedFields(mismatchDependencies.observe)["webhook.reject_reason"])
      .toBe("secret_mismatch");
  });

  it("does not claim the delivery key when verification fails", async () => {
    const dependencies = makeDependencies();

    await handleGooglePushWebhook(
      { request: makeRequest({ "x-goog-channel-token": "c".repeat(64) }) },
      dependencies,
    );

    expect(dependencies.claimDelivery).not.toHaveBeenCalled();
  });

  it("rejects a notification carrying no channel token", async () => {
    const dependencies = makeDependencies();
    const request = new Request("https://www.example.com/api/webhook/google", {
      headers: {
        "x-goog-channel-id": CHANNEL_KEY,
        "x-goog-message-number": "7",
        "x-goog-resource-state": "exists",
      },
      method: "POST",
    });

    const response = await handleGooglePushWebhook({ request }, dependencies);

    expect(response.status).toBe(400);
    expect(dependencies.findChannel).not.toHaveBeenCalled();
  });
});

describe("handleGooglePushWebhook duplicate suppression", () => {
  it("does no work for a replayed delivery", async () => {
    const dependencies = makeDependencies({
      claimDelivery: vi.fn(() => Promise.resolve(false)),
    });

    const response = await handleGooglePushWebhook(
      { request: makeRequest() },
      dependencies,
    );

    expect(response.status).toBe(200);
    expect(dependencies.markPendingIngest).not.toHaveBeenCalled();
    expect(observedFields(dependencies.observe)["webhook.duplicate"]).toBe(true);
  });

  it("claims the delivery once per channel and message number", async () => {
    const dependencies = makeDependencies();

    await handleGooglePushWebhook({ request: makeRequest() }, dependencies);

    expect(dependencies.claimDelivery).toHaveBeenCalledOnce();
    const [deliveryKey] = dependencies.claimDelivery.mock.calls[0] as [string];
    expect(deliveryKey).toContain(CHANNEL_KEY);
    expect(deliveryKey).toContain("7");
  });
});

describe("handleGooglePushWebhook failure handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fails closed with 503 when the admission counter is unavailable", async () => {
    const dependencies = makeDependencies({
      claimPushAdmission: vi.fn(() => Promise.reject(new Error("redis down"))),
    });

    const response = await handleGooglePushWebhook(
      { request: makeRequest() },
      dependencies,
    );

    expect(response.status).toBe(503);
  });

  it("fails closed with 503 when the channel lookup is unavailable", async () => {
    const dependencies = makeDependencies({
      findChannel: vi.fn(() => Promise.reject(new Error("database down"))),
    });

    const response = await handleGooglePushWebhook(
      { request: makeRequest() },
      dependencies,
    );

    expect(response.status).toBe(503);
  });

  it("fails closed with 503 when the pending ingest write is unavailable", async () => {
    const dependencies = makeDependencies({
      markPendingIngest: vi.fn(() => Promise.reject(new Error("redis down"))),
    });

    const response = await handleGooglePushWebhook(
      { request: makeRequest() },
      dependencies,
    );

    expect(response.status).toBe(503);
  });

  it("sheds an over-budget notification before consulting the channel table", async () => {
    const dependencies = makeDependencies({
      claimPushAdmission: vi.fn(() => Promise.resolve(false)),
    });

    const response = await handleGooglePushWebhook(
      { request: makeRequest() },
      dependencies,
    );

    expect(response.status).toBe(503);
    expect(dependencies.findChannel).not.toHaveBeenCalled();
    expect(dependencies.claimDelivery).not.toHaveBeenCalled();
    expect(observedFields(dependencies.observe)["webhook.reject_reason"])
      .toBe("admission_throttled");
  });

  it("admits the delivery before the request body is read", async () => {
    const callLog: string[] = [];
    const dependencies = makeDependencies({
      claimPushAdmission: vi.fn((_input: { channelKey: string | null; provider: string }) => {
        callLog.push("admission");
        return Promise.resolve(true);
      }),
    });

    await handleGooglePushWebhook({ request: streamingRequest(callLog, "{}") }, dependencies);

    expect(callLog.indexOf("admission")).toBeGreaterThanOrEqual(0);
    expect(callLog.indexOf("admission")).toBeLessThan(callLog.indexOf("body"));
  });

  it("caps the bytes actually read when no content length is declared", async () => {
    const callLog: string[] = [];
    const dependencies = makeDependencies();
    const oversized = "x".repeat(300_000);

    const response = await handleGooglePushWebhook(
      { request: streamingRequest(callLog, oversized) },
      dependencies,
    );

    expect(response.status).toBe(413);
    expect(dependencies.findChannel).not.toHaveBeenCalled();
    expect(dependencies.claimDelivery).not.toHaveBeenCalled();
    expect(observedFields(dependencies.observe)["webhook.reject_reason"]).toBe("body_too_large");
  });

  it("rejects an oversized body without reading it", async () => {
    const dependencies = makeDependencies();
    const request = new Request("https://www.example.com/api/webhook/google", {
      body: "x",
      headers: {
        "content-length": "1000000",
        "x-goog-channel-id": CHANNEL_KEY,
        "x-goog-channel-token": SECRET,
        "x-goog-message-number": "7",
        "x-goog-resource-id": "google-resource-1",
        "x-goog-resource-state": "exists",
      },
      method: "POST",
    });

    const response = await handleGooglePushWebhook({ request }, dependencies);

    expect(response.status).toBe(413);
    expect(dependencies.findChannel).not.toHaveBeenCalled();
  });
});

describe("handleGooglePushWebhook negative cache", () => {
  it("bounds and short-circuits repeated unknown channel lookups", async () => {
    const findChannel = vi.fn(() => Promise.resolve(null));
    const rememberUnknownChannel = vi.fn(
      (_provider: string, _channelKey: string, _ttlSeconds: number) => Promise.resolve(),
    );
    let cached = false;
    const isUnknownChannelCached = vi.fn(() => Promise.resolve(cached));
    const dependencies = makeDependencies({
      findChannel,
      isUnknownChannelCached,
      rememberUnknownChannel,
    });

    const first = await handleGooglePushWebhook({ request: makeRequest() }, dependencies);
    expect(first.status).toBe(401);
    expect(findChannel).toHaveBeenCalledOnce();
    expect(rememberUnknownChannel).toHaveBeenCalledOnce();
    const rememberCall = rememberUnknownChannel.mock.calls[0] as [string, string, number];
    expect(rememberCall[2]).toBeGreaterThan(0);
    expect(rememberCall[2]).toBeLessThanOrEqual(60);

    cached = true;
    const second = await handleGooglePushWebhook({ request: makeRequest() }, dependencies);

    expect(second.status).toBe(401);
    expect(findChannel).toHaveBeenCalledOnce();
    expect(observedFields(dependencies.observe)["webhook.negative_cache_hit"]).toBe(true);
  });
});
