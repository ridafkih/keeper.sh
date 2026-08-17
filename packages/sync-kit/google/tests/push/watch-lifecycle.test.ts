import { describe, expect, test } from "vitest";
import { createRequestSeam } from "../../src/client/request";
import { createSemaphore } from "../../src/client/semaphore";
import { googleWatchProfile, renewalInstantOf } from "../../src/push/profile";
import { registerWatchChannel, renewWatchChannel } from "../../src/push/watch";
import { createHarness, googleCalendar, operationContext } from "../support/harness";

const surroundingsOf = (harness: ReturnType<typeof createHarness>) => ({
  dependencies: harness.dependencies,
  requests: createRequestSeam({
    dependencies: harness.dependencies,
    permits: createSemaphore(harness.dependencies.concurrency),
  }),
});

const hash = (input: string): string => `hashed:${input}`;

const watchRequest = {
  calendar: googleCalendar,
  callbackUrl: "https://keeper.sh/push/google",
  token: "the-real-token",
};

describe("watch channels are recreated, never extended", () => {
  test("GOOG-P3: the server's expiration is the one that is stored", async () => {
    const harness = createHarness();

    const registered = await registerWatchChannel(
      watchRequest,
      operationContext(harness.environment),
      surroundingsOf(harness),
    );

    if (!registered.ok) {
      throw new Error(`registering a channel failed as "${registered.failure.kind}"`);
    }
    expect(registered.value.resourceId).toBe("resource-1");
    expect(Date.parse(registered.value.expiration.value)).toBeGreaterThan(0);
  });

  test("GOOG-P3: a renewal registers a new channel before it stops the old one", async () => {
    const harness = createHarness();
    const surroundings = surroundingsOf(harness);
    const registered = await registerWatchChannel(
      watchRequest,
      operationContext(harness.environment),
      surroundings,
    );
    if (!registered.ok) {
      throw new Error(`registering a channel failed as "${registered.failure.kind}"`);
    }

    const renewed = await renewWatchChannel(
      registered.value,
      watchRequest,
      operationContext(harness.environment),
      surroundings,
    );

    if (!renewed.ok) {
      throw new Error(`renewing a channel failed as "${renewed.failure.kind}"`);
    }
    expect(renewed.value.channel.channelId).not.toBe(registered.value.channelId);
    expect(renewed.value.superseded.ok).toBe(true);
    expect(harness.fake.channels().map((channel) => channel.id)).toEqual([
      renewed.value.channel.channelId,
    ]);
  });

  test("GOOG-P3: a renewal whose stop failed reports the channel it could not close", async () => {
    const harness = createHarness();
    const surroundings = surroundingsOf(harness);
    const registered = await registerWatchChannel(
      watchRequest,
      operationContext(harness.environment),
      surroundings,
    );
    if (!registered.ok) {
      throw new Error(`registering a channel failed as "${registered.failure.kind}"`);
    }
    harness.fake.failWriteOn({
      onCall: 3,
      status: 500,
      reason: "backendError",
      bodyShape: "json",
    });

    const renewed = await renewWatchChannel(
      registered.value,
      watchRequest,
      operationContext(harness.environment),
      surroundings,
    );

    if (!renewed.ok) {
      throw new Error(`renewing a channel failed as "${renewed.failure.kind}"`);
    }
    expect(renewed.value.superseded.ok).toBe(false);
  });

  test("GOOG-P3: renewal instants are staggered per calendar and never land after expiry", () => {
    const expiration = { kind: "instant", value: "2026-03-18T00:00:00.000Z" } as const;
    const one = renewalInstantOf(expiration, "calendar-one", hash);
    const other = renewalInstantOf(expiration, "calendar-two", hash);

    expect(one.value).not.toBe(other.value);
    expect(Date.parse(one.value)).toBeLessThanOrEqual(Date.parse(expiration.value));
    expect(Date.parse(other.value)).toBeLessThanOrEqual(Date.parse(expiration.value));
  });

  test("GOOG-P3: the profile recreates rather than extends, inside Google's seven-day maximum", () => {
    expect(googleWatchProfile.renewal).toBe("recreate");
    expect(googleWatchProfile.maximumLifetimeMs).toBe(7 * 24 * 60 * 60 * 1000);
    expect(googleWatchProfile.renewalLeadMs).toBeLessThan(googleWatchProfile.maximumLifetimeMs);
  });
});
