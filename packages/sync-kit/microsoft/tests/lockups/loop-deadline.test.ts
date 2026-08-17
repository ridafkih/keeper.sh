import type { Instant } from "@keeper.sh/sync-protocol";
import { describe, expect, test } from "vitest";
import { paginateGraph } from "../../src/listing/paginate";
import { microsoftLimits } from "../../src/limits";
import { createHarness, operationContext, suiteStart } from "../support/harness";

describe("pages that are each fast enough still end the loop", () => {
  test("MS-L12: pages that each finish under the per-request deadline still end at the loop deadline", async () => {
    const harness = createHarness();
    let elapsed = 0;
    let pagesRequested = 0;
    const marching = {
      now: (): Instant => ({
        kind: "instant",
        value: new Date(Date.parse(suiteStart.value) + elapsed).toISOString(),
      }),
      sleep: harness.environment.clock.sleep,
    };

    const walk = await paginateGraph({
      context: operationContext(harness.environment, { deadlineMs: 1000 }),
      clock: marching,
      maxPages: microsoftLimits.maxPages,
      fetchPage: () => {
        pagesRequested += 1;
        elapsed += 400;
        return Promise.resolve({
          kind: "page",
          page: {
            items: [{ id: `page-${pagesRequested}` }],
            nextLink: `https://graph.microsoft.com/v1.0/calendarView?$skiptoken=${pagesRequested}`,
            deltaLink: null,
          },
        } as const);
      },
    });

    expect(pagesRequested).toBeLessThan(microsoftLimits.maxPages);
    expect(walk.kind).toBe("truncated");
    if (walk.kind !== "truncated") {
      throw new Error("a loop that ran out of budget threw away the pages it had read");
    }
    expect(walk.stoppedBy).toBe("loopDeadline");
    expect(walk.items).toHaveLength(pagesRequested);
  }, 30_000);
});
