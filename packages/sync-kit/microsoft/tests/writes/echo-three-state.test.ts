import { describe, expect, test } from "vitest";
import { echoVerdictOf } from "../../src/write/echo";
import { outcomeOf } from "../support/expect";
import { createHarness, operationContext } from "../support/harness";
import { createIntent, normalizedOf, timedContent } from "../support/intents";
import { seedOf } from "../support/items";

describe("we never looked is not the same answer as it matched", () => {
  test("MS-O23: an unobserved echo is notObserved, never matched", () => {
    expect(echoVerdictOf(normalizedOf(timedContent()), null)).toEqual({ kind: "notObserved" });
  });

  test("MS-O23: an echo that differs names the fields that diverged", () => {
    const submitted = normalizedOf(timedContent({ title: "the title we sent" }));

    const verdict = echoVerdictOf(submitted, {
      id: "id-created",
      subject: "the title Outlook stored instead",
      body: { contentType: "text", content: "" },
      start: { dateTime: "2026-03-21T09:00:00.0000000", timeZone: "UTC" },
      end: { dateTime: "2026-03-21T10:00:00.0000000", timeZone: "UTC" },
      isAllDay: false,
    });

    expect(verdict.kind).toBe("diverged");
  });

  test("MS-O23: a create carries its echo verdict out with the outcome", async () => {
    const harness = createHarness();
    harness.fake.seedFromProvider(seedOf([]));

    const created = outcomeOf(
      await harness.provider.write(
        createIntent("idempotency-echo", normalizedOf(timedContent()), "microsoft-tests"),
        operationContext(harness.environment),
      ),
    );

    if (created.kind !== "created") {
      throw new Error(`a create answered "${created.kind}"`);
    }
    expect(created.echo.kind).toBe("matched");
  }, 30_000);
});
