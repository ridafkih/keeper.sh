import { describe, expectTypeOf, test } from "vitest";
import type { GraphLifecycleEvent, LifecycleOutcome } from "../../src/push/lifecycle";
import { lifecycleOutcomeOf } from "../../src/push/lifecycle";

describe("a new lifecycle event cannot be added without handling it", () => {
  test("MS-P8: a new lifecycle event does not typecheck until it is handled", () => {
    expectTypeOf<GraphLifecycleEvent>().toEqualTypeOf<
      "reauthorizationRequired" | "subscriptionRemoved" | "missed"
    >();
    expectTypeOf(lifecycleOutcomeOf).parameter(0).toEqualTypeOf<GraphLifecycleEvent>();
    expectTypeOf(lifecycleOutcomeOf).returns.toEqualTypeOf<LifecycleOutcome>();
    expectTypeOf<"subscriptionExpired">().not.toMatchTypeOf<GraphLifecycleEvent>();
  });
});
