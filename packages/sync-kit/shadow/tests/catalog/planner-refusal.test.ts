import { describe, expect, test } from "vitest";
import { ReconcileInternalDataError } from "@keeper.sh/sync-reconcile";
import { defaultShadowLimits, renderCatalog } from "../../src/index";
import { inputOver, runShadow } from "../support/scenario";
import {
  mirrorRow,
  shadowOptions,
  slotIdentity,
  sourceCalendarB,
  storedSourceEvent,
  syncInput,
} from "../support/fixtures";

const identity = slotIdentity("evt-one", "2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z");

const throwingPlan = (error: Error) => () => {
  throw error;
};

describe("a planner that refuses is not a clean run", () => {
  test("SHADOW-I21: a duplicate mapping claim renders as plannerRefused, not as zero deletions", () => {
    const catalog = runShadow(
      inputOver([identity]),
      shadowOptions({
        plan: throwingPlan(
          new ReconcileInternalDataError("two mappings claim the source identity evt-one"),
        ),
      }),
    );

    expect(catalog.kind).toBe("plannerRefused");
    if (catalog.kind !== "plannerRefused") {
      throw new Error("expected a planner refusal");
    }
    expect(catalog.invariant).toContain("two mappings claim the source identity");
    expect(Reflect.get(catalog, "deletions")).toBeUndefined();
  });

  test("SHADOW-I21: a planner refusal names the source calendar whose plan died", () => {
    const catalog = runShadow(
      syncInput({
        storedSourceEvents: [storedSourceEvent({ identity })],
        mirrors: [mirrorRow({ identity })],
      }),
      shadowOptions({
        plan: throwingPlan(new ReconcileInternalDataError("a known row was recorded elsewhere")),
      }),
    );
    if (catalog.kind !== "plannerRefused") {
      throw new Error("expected a planner refusal");
    }

    expect(catalog.sourceCalendar.calendar.value).toBe("cal-source-a");
    expect(catalog.sourceCalendar.calendar.value).not.toBe(sourceCalendarB.calendar.value);
  });

  test("SHADOW-I21: a planner refusal renders as its own outcome", () => {
    const rendered = renderCatalog(
      runShadow(
        inputOver([identity]),
        shadowOptions({ plan: throwingPlan(new ReconcileInternalDataError("broken")) }),
      ),
      defaultShadowLimits,
    );

    expect(rendered["shadow.outcome"]).toBe("plannerRefused");
    expect(Object.hasOwn(rendered, "shadow.deletions.total")).toBe(false);
  });

  test("SHADOW-I21: a non-reconcile error is not swallowed", () => {
    expect(() =>
      runShadow(
        inputOver([identity]),
        shadowOptions({ plan: throwingPlan(new TypeError("something else entirely")) }),
      ),
    ).toThrow(TypeError);
  });
});
