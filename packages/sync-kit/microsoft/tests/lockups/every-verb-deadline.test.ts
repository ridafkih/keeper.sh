import { describe, expect, test } from "vitest";
import { microsoftAccount } from "../support/harness";
import { createHarness, marchWindow, operationContext, scopeOver } from "../support/harness";
import { createIntent, normalizedOf, timedContent } from "../support/intents";

describe("every verb has a ceiling, not just the one that was tested first", () => {
  test("MS-L9: listCalendars, listChanges and write each reject against a stub that never resolves", async () => {
    const harness = createHarness();
    harness.environment.transport.stall();
    const context = operationContext(harness.environment, { deadlineMs: 20 });

    const answered = await Promise.all([
      harness.provider.listCalendars(microsoftAccount, context),
      harness.provider.listChanges({ scope: scopeOver(marchWindow), resume: null }, context),
      harness.provider.write(
        createIntent("idempotency-one", normalizedOf(timedContent()), "microsoft-tests"),
        context,
      ),
    ]);

    expect(answered.map((result) => result.ok)).toEqual([false, false, false]);
    expect(harness.environment.clock.pendingTimers()).toBe(0);
  }, 30_000);
});
