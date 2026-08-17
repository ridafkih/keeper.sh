import type { OperationContext, Result } from "@keeper.sh/sync-protocol";
import { describe, expect, test } from "vitest";
import { failureKindOf } from "../support/expect";
import {
  caldavAccount,
  createHarness,
  decadeWindow,
  operationContext,
  scopeOver,
} from "../support/harness";
import {
  createIntent,
  deleteIntent,
  normalizedOf,
  retireIntent,
  timedContent,
  updateIntent,
  versionOf,
} from "../support/intents";
import type { Harness } from "../support/harness";

type Verb = (harness: Harness, context: OperationContext) => Promise<Result<unknown>>;

const verbs: readonly (readonly [string, Verb])[] = [
  ["listCalendars", (harness, context) => harness.provider.listCalendars(caldavAccount, context)],
  [
    "listChanges",
    (harness, context) =>
      harness.provider.listChanges({ scope: scopeOver(decadeWindow), resume: null }, context),
  ],
  [
    "write:create",
    (harness, context) =>
      harness.provider.write(
        createIntent("idem-one", normalizedOf(timedContent()), "caldav-tests"),
        context,
      ),
  ],
  [
    "write:update",
    (harness, context) =>
      harness.provider.write(
        updateIntent(
          "/calendars/alice/personal/one.ics",
          normalizedOf(timedContent()),
          versionOf('"etag-1"'),
        ),
        context,
      ),
  ],
  [
    "write:delete",
    (harness, context) =>
      harness.provider.write(
        deleteIntent("/calendars/alice/personal/one.ics", versionOf('"etag-1"')),
        context,
      ),
  ],
  [
    "write:retire",
    (harness, context) =>
      harness.provider.write(
        retireIntent("/calendars/alice/personal/one.ics", versionOf('"etag-1"')),
        context,
      ),
  ],
];

describe("no provider verb can outlive its deadline", () => {
  test("DAV-L6: listCalendars, listChanges and all four write verbs each reject at the deadline against a stalling stub", async () => {
    const outcomes: Record<string, string> = {};
    for (const [name, verb] of verbs) {
      const harness = createHarness({ fake: { stalls: true } });
      const answered = await verb(harness, operationContext(harness.environment, { deadlineMs: 20 }));
      outcomes[name] = failureKindOf(answered);
      expect(harness.environment.clock.pendingTimers()).toBe(0);
    }

    expect(outcomes).toEqual({
      listCalendars: "notAttempted",
      listChanges: "notAttempted",
      "write:create": "notAttempted",
      "write:update": "notAttempted",
      "write:delete": "notAttempted",
      "write:retire": "notAttempted",
    });
  }, 30_000);
});
