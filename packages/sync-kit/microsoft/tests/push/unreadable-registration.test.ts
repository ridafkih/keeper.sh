import { describe, expect, test } from "vitest";
import { createRequestSeam } from "../../src/client/request";
import { createMailboxSemaphore } from "../../src/client/semaphore";
import { microsoftLimits } from "../../src/limits";
import { registerSubscription, subscriptionScopeOf } from "../../src/push/subscription";
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

describe("a registration Graph did not describe is never invented", () => {
  test("MS-P24: a 201 without an id fails rather than minting an empty subscription", async () => {
    const harness = createHarness();
    harness.fake.withholdSubscriptionId();
    const requests = createRequestSeam({
      dependencies: harness.dependencies,
      permits: createMailboxSemaphore(microsoftLimits.mailboxConcurrency),
    });

    const answered = await registerSubscription(
      {
        scope: scopeOrThrow(),
        resource: "events",
        includeResourceData: false,
        notificationUrl: "https://keeper.sh/webhook/outlook",
        lifecycleNotificationUrl: "https://keeper.sh/webhook/outlook/lifecycle",
        clientState: "the-shared-secret",
      },
      operationContext(harness.environment, { deadlineMs: 5000 }),
      { dependencies: harness.dependencies, requests },
    );

    const addressedRows = harness.fake
      .requests()
      .filter((request) => request.path.includes("subscriptions/"));
    expect(answered.ok).toBe(false);
    expect(addressedRows).toEqual([]);
  }, 30_000);
});
