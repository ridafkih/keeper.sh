import { describe, expect, test } from "vitest";
import { failureKindOf } from "../support/expect";
import { calendarPath, secondCalendarPath } from "../support/fake-caldav";
import { createHarness, operationContext } from "../support/harness";
import { createIntent, normalizedOf, timedContent } from "../support/intents";

const hostileKeys = ["../work/stolen", "..%2Fwork%2Fstolen", "nested/segment", "..", ""];

describe("an idempotency key names one resource inside the collection it was given", () => {
  test("DAV-O69: a key carrying a path segment is refused before any request is made", async () => {
    for (const value of hostileKeys) {
      const harness = createHarness();
      const answered = await harness.provider.write(
        createIntent(value, normalizedOf(timedContent()), "keeper-tests"),
        operationContext(harness.environment, { deadlineMs: 2000 }),
      );

      expect(failureKindOf(answered)).toBe("unsupported");
      expect(harness.fake.requestsOf("PUT")).toEqual([]);
    }
  }, 30_000);

  test("DAV-O69: no request a hostile key provokes ever leaves the collection it was given", async () => {
    const harness = createHarness();

    await harness.provider.write(
      createIntent("../work/stolen", normalizedOf(timedContent()), "keeper-tests"),
      operationContext(harness.environment, { deadlineMs: 2000 }),
    );

    const escaped = harness.fake
      .requests()
      .filter((entry) => !entry.path.startsWith(calendarPath) && entry.method !== "OPTIONS");
    expect(escaped.filter((entry) => entry.path.startsWith(secondCalendarPath))).toEqual([]);
    expect(harness.fake.resources()).toEqual([]);
  }, 30_000);
});
