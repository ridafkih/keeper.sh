import { derivableRemovals } from "@keeper.sh/sync-conformance";
import { describe, expect, test } from "vitest";
import { withinCalDAVWindow } from "../../src/window/membership";
import { knownMirrorOf, listingOf } from "../support/expect";
import { calendarPath } from "../support/fake-caldav";
import { createHarness, marchWindow, operationContext, scopeOver } from "../support/harness";
import { singleEventResource } from "../support/resources";

describe("an unreadable body is a hole in the read, not a hole in the calendar", () => {
  test("DAV-O68: a resource that became unreadable between polls cannot be derived as a removal", async () => {
    const harness = createHarness({
      resources: [
        singleEventResource("kept.ics", { uid: "kept@example.com" }),
        singleEventResource("garbled.ics", { uid: "garbled@example.com" }),
      ],
    });
    const scope = scopeOver(marchWindow);
    const context = operationContext(harness.environment, { deadlineMs: 2000 });
    const first = listingOf(await harness.provider.listChanges({ scope, resume: null }, context));

    harness.fake.put(`${calendarPath}garbled.ics`, "not a calendar at all");
    const second = listingOf(await harness.provider.listChanges({ scope, resume: null }, context));

    expect(first.kind).toBe("snapshot");
    expect(second.kind).toBe("partial");
    expect(
      derivableRemovals({
        listing: second,
        known: knownMirrorOf(first.events ?? []),
        withinWindow: withinCalDAVWindow,
      }),
    ).toEqual([]);
  }, 30_000);

  test("DAV-O68: an unreadable resource never counts toward the coverage the snapshot claims", async () => {
    const harness = createHarness({
      resources: [
        singleEventResource("kept.ics", { uid: "kept@example.com" }),
        { path: `${calendarPath}garbled.ics`, data: "not a calendar at all" },
      ],
    });

    const listing = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(marchWindow), resume: null },
        operationContext(harness.environment, { deadlineMs: 2000 }),
      ),
    );

    expect(listing.kind).toBe("partial");
    expect(listing.coverage).toBeUndefined();
  }, 30_000);
});
