import { describe, expectTypeOf, test } from "vitest";
import { serialiseCalendarResource } from "../../src/index";
import type { CanonicalEvent, RecurrenceSet } from "../../src/index";

describe("the writer's input shape", () => {
  test("ICAL-O37: the writer takes a recurrence set, not a component list", () => {
    expectTypeOf(serialiseCalendarResource).parameter(0).toEqualTypeOf<RecurrenceSet>();
    expectTypeOf<readonly CanonicalEvent[]>().not.toMatchTypeOf<RecurrenceSet>();
  });

  test("ICAL-I40: a set names exactly one master, its overrides, and the SEQUENCE they share", () => {
    expectTypeOf<keyof RecurrenceSet>().toEqualTypeOf<"master" | "overrides" | "sequence">();
  });
});
