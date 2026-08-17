import { describe, expect, test } from "vitest";
import { createHarness, microsoftAccount, operationContext } from "../support/harness";

describe("enumeration tolerates the shapes Graph actually answers", () => {
  test("MS-O44: an enumeration with absent items and absent display names still answers", async () => {
    const harness = createHarness();
    harness.fake.answerCalendarsWith({
      value: [
        { id: "AAMkAGVmMDEz", name: null, canEdit: true },
        { id: "AAMkAGVmMDE0", canEdit: false },
        { name: "a calendar with no id at all" },
      ],
    });

    const answered = await harness.provider.listCalendars(
      microsoftAccount,
      operationContext(harness.environment),
    );

    if (!answered.ok) {
      throw new Error(`enumeration failed as "${answered.failure.kind}"`);
    }
    expect(answered.value.calendars.map((calendar) => calendar.key.calendar.value)).toEqual([
      "AAMkAGVmMDEz",
      "AAMkAGVmMDE0",
    ]);
    expect(answered.value.calendars.map((calendar) => calendar.access)).toEqual([
      "readWrite",
      "readOnly",
    ]);
  }, 30_000);

  test("MS-O44: an enumeration whose body carries no value array is a failure, not an empty calendar list", async () => {
    const harness = createHarness();
    harness.fake.answerCalendarsWith({ unexpected: true });

    const answered = await harness.provider.listCalendars(
      microsoftAccount,
      operationContext(harness.environment),
    );

    expect(answered.ok).toBe(false);
  }, 30_000);
});
