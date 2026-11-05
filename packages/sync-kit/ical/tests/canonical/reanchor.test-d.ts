import { describe, expectTypeOf, test } from "vitest";
import { reanchorRecurrenceIdentities } from "../../src/index";
import type { RecurrenceIdentitySet } from "../../src/index";

describe("moving a recurring series in time", () => {
  test("ICAL-O25: DTSTART cannot be moved without its recurrence identities", () => {
    expectTypeOf(reanchorRecurrenceIdentities)
      .parameter(0)
      .toEqualTypeOf<RecurrenceIdentitySet>();
    expectTypeOf<keyof RecurrenceIdentitySet>().toEqualTypeOf<
      "start" | "exceptions" | "overrideInstants" | "until"
    >();
  });

  test("ICAL-I27: the re-anchored value is the whole set, never a bare instant", () => {
    expectTypeOf(reanchorRecurrenceIdentities).returns.toEqualTypeOf<RecurrenceIdentitySet>();
  });
});
