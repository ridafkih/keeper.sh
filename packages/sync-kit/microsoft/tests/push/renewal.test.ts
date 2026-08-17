import type { Instant } from "@keeper.sh/sync-protocol";
import { describe, expect, test } from "vitest";
import { createRequestSeam } from "../../src/client/request";
import { createMailboxSemaphore } from "../../src/client/semaphore";
import { microsoftLimits } from "../../src/limits";
import type { GraphSubscription } from "../../src/push/subscription";
import { renewSubscription } from "../../src/push/subscription";
import { failureKindOf } from "../support/expect";
import { createHarness, operationContext, suiteStart } from "../support/harness";

const expiringSoon: Instant = { kind: "instant", value: "2026-03-12T00:00:00.000Z" };

const subscription: GraphSubscription = {
  id: "subscription-one",
  resource: "users/mailbox-one/calendars/AAMkAGVmMDEz/events",
  notificationUrl: "https://keeper.sh/webhook/outlook",
  expiration: expiringSoon,
  includesResourceData: false,
  createdAt: suiteStart,
};

const surroundingsOf = (harness: ReturnType<typeof createHarness>) => ({
  dependencies: harness.dependencies,
  requests: createRequestSeam({
    dependencies: harness.dependencies,
    permits: createMailboxSemaphore(microsoftLimits.mailboxConcurrency),
  }),
});

describe("a vanished subscription and a throttled one are different answers", () => {
  test("MS-P11: a 404 on renewal is gone and a 429 is not", async () => {
    const vanished = createHarness();
    vanished.fake.failWriteOn({ onCall: 1, status: 404, code: "ResourceNotFound" });
    const throttled = createHarness();
    throttled.fake.failWriteOn({ onCall: 1, status: 429, code: "activityLimitReached", retryAfter: "1" });

    const gone = await renewSubscription(
      subscription,
      operationContext(vanished.environment, { deadlineMs: 5000 }),
      surroundingsOf(vanished),
    );
    const busy = await renewSubscription(
      subscription,
      operationContext(throttled.environment, { deadlineMs: 5000 }),
      surroundingsOf(throttled),
    );

    expect(failureKindOf(gone)).toBe("notFound");
    expect(failureKindOf(busy)).toBe("rateLimited");
  }, 30_000);

  test("MS-P11: a renewal is a PATCH of the expiry, never a re-creation", async () => {
    const harness = createHarness();
    harness.fake.putSubscription({
      id: "subscription-one",
      resource: subscription.resource,
      notificationUrl: subscription.notificationUrl,
      changeType: "created,updated,deleted",
    });

    await renewSubscription(
      subscription,
      operationContext(harness.environment, { deadlineMs: 5000 }),
      surroundingsOf(harness),
    );

    const methods = harness.fake.requests().map((request) => request.method);
    expect(methods).toContain("PATCH");
    expect(methods).not.toContain("POST");
  }, 30_000);
});
