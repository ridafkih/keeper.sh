import { describe, expect, test } from "vitest";
import { createRequestSeam } from "../../src/client/request";
import { createMailboxSemaphore } from "../../src/client/semaphore";
import { microsoftLimits } from "../../src/limits";
import { registerSubscription, subscriptionScopeOf } from "../../src/push/subscription";
import { failureKindOf } from "../support/expect";
import { createHarness, microsoftCalendar, operationContext } from "../support/harness";

const scopeOrThrow = () => {
  const outcome = subscriptionScopeOf({
    providerAccountId: "mailbox-one",
    calendar: microsoftCalendar.calendar,
  });
  if (outcome.kind !== "scoped") {
    throw new Error("a scope with a provider account id was withheld");
  }
  return outcome.scope;
};

describe("a 409 on create is a duplicate, and it is distinguishable", () => {
  test("MS-P12: a 409 on create is a duplicate outcome, not a transport failure", async () => {
    const harness = createHarness();
    const requests = createRequestSeam({
      dependencies: harness.dependencies,
      permits: createMailboxSemaphore(microsoftLimits.mailboxConcurrency),
    });
    const request = {
      scope: scopeOrThrow(),
      resource: "events",
      includeResourceData: false,
      notificationUrl: "https://keeper.sh/webhook/outlook",
      lifecycleNotificationUrl: "https://keeper.sh/webhook/outlook/lifecycle",
      clientState: "the-shared-secret",
    } as const;

    const first = await registerSubscription(
      request,
      operationContext(harness.environment, { deadlineMs: 5000 }),
      { dependencies: harness.dependencies, requests },
    );
    const second = await registerSubscription(
      request,
      operationContext(harness.environment, { deadlineMs: 5000 }),
      { dependencies: harness.dependencies, requests },
    );

    expect(first.ok).toBe(true);
    expect(failureKindOf(second)).toBe("conflict");
    expect(harness.fake.subscriptions()).toHaveLength(1);
  }, 30_000);
});
