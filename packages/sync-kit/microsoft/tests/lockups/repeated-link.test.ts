import { describe, expect, test } from "vitest";
import { paginateGraph } from "../../src/listing/paginate";
import { microsoftLimits } from "../../src/limits";
import { createHarness, operationContext } from "../support/harness";

const linkA = "https://graph.microsoft.com/v1.0/calendarView?$skiptoken=a";
const linkB = "https://graph.microsoft.com/v1.0/calendarView?$skiptoken=b";

const aThenBThenAAgain = (): readonly (string | null)[] => [linkA, linkB, linkA];

describe("a link already walked ends the walk before the ceiling", () => {
  test("MS-L11: a nextLink already walked ends the walk below the ceiling", async () => {
    const harness = createHarness();
    const nextLinks = aThenBThenAAgain();
    let pagesRequested = 0;

    const walk = await paginateGraph({
      context: operationContext(harness.environment, { deadlineMs: 5000 }),
      clock: harness.environment.clock,
      maxPages: microsoftLimits.maxPages,
      fetchPage: () => {
        const nextLink = nextLinks.at(pagesRequested) ?? linkA;
        pagesRequested += 1;
        return Promise.resolve({
          kind: "page",
          page: { items: [{ id: `page-${pagesRequested}` }], nextLink, deltaLink: null },
        } as const);
      },
    });

    expect(pagesRequested).toBeLessThan(microsoftLimits.maxPages);
    expect(walk.kind).toBe("truncated");
    if (walk.kind !== "truncated") {
      throw new Error("a repeated link discarded the pages it had already read");
    }
    expect(walk.stoppedBy).toBe("repeatedLink");
    expect(walk.items).toHaveLength(pagesRequested);
  }, 30_000);
});
