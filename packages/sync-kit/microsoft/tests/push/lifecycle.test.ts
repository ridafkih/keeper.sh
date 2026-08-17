import { describe, expect, test } from "vitest";
import { graphLifecycleEvents, lifecycleOutcomeOf } from "../../src/push/lifecycle";

describe("the three lifecycle events are three different outcomes", () => {
  test("MS-P7: missed schedules an ingest and leaves the cursor untouched", () => {
    const missed = lifecycleOutcomeOf("missed");

    expect(missed.schedulesIngest).toBe(true);
    expect(missed.cursorEffect).toBe("keep");
    expect(missed.marksChannel).toBe("unchanged");
  });

  test("MS-P7: reauthorizationRequired marks the channel and triggers no ingest", () => {
    const reauthorize = lifecycleOutcomeOf("reauthorizationRequired");

    expect(reauthorize.schedulesIngest).toBe(false);
    expect(reauthorize.marksChannel).toBe("reauthorizationRequired");
  });

  test("MS-P7: subscriptionRemoved marks the channel removed and schedules an ingest", () => {
    const removed = lifecycleOutcomeOf("subscriptionRemoved");

    expect(removed.schedulesIngest).toBe(true);
    expect(removed.marksChannel).toBe("removed");
    expect(graphLifecycleEvents).toHaveLength(3);
  });
});
