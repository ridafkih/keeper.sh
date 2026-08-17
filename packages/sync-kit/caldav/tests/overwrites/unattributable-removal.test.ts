import { derivableRemovals } from "@keeper.sh/sync-conformance";
import { describe, expect, test } from "vitest";
import { withinCalDAVWindow } from "../../src/window/membership";
import { cursorOf, knownMirrorOf, listingOf } from "../support/expect";
import { atticPath, calendarPath } from "../support/fake-caldav";
import { createHarness, marchWindow, operationContext, scopeOver } from "../support/harness";
import { singleEventResource } from "../support/resources";

const collection = [
  singleEventResource("one.ics", { uid: "one@example.com", summary: "One" }),
  singleEventResource("two.ics", { uid: "two@example.com", summary: "Two" }),
];

describe("an RFC 6578 404 names a path and no UID", () => {
  test("DAV-O12: a 404 href the adapter never reported is an out-of-scope marker, never a deletion", async () => {
    const harness = createHarness({ resources: collection });
    const scope = scopeOver(marchWindow);
    const context = operationContext(harness.environment, { deadlineMs: 2000 });
    const first = listingOf(await harness.provider.listChanges({ scope, resume: null }, context));
    harness.fake.put(`${calendarPath}never-listed.ics`, "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n");
    harness.fake.remove(`${calendarPath}never-listed.ics`);

    const second = listingOf(
      await harness.provider.listChanges({ scope, resume: cursorOf(first) }, context),
    );

    expect((second.removals ?? []).map((removal) => removal.kind)).toEqual(["outOfScope"]);
    expect(
      derivableRemovals({
        listing: second,
        known: knownMirrorOf(first.events ?? []),
        withinWindow: withinCalDAVWindow,
      }),
    ).toEqual([]);
  }, 30_000);

  test("DAV-O12: a 404 href outside the collection being listed is not a removal at all", async () => {
    const harness = createHarness({ resources: collection });
    const scope = scopeOver(marchWindow);
    const context = operationContext(harness.environment, { deadlineMs: 2000 });
    const first = listingOf(await harness.provider.listChanges({ scope, resume: null }, context));
    harness.fake.put(`${atticPath}elsewhere.ics`, "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n");
    harness.fake.remove(`${atticPath}elsewhere.ics`);

    const second = listingOf(
      await harness.provider.listChanges({ scope, resume: cursorOf(first) }, context),
    );

    expect(second.removals ?? []).toEqual([]);
  }, 30_000);

  test("DAV-O13: a 404 href the adapter did report is named as the deletion it is", async () => {
    const harness = createHarness({ resources: collection });
    const scope = scopeOver(marchWindow);
    const context = operationContext(harness.environment, { deadlineMs: 2000 });
    const first = listingOf(await harness.provider.listChanges({ scope, resume: null }, context));
    harness.fake.remove(`${calendarPath}two.ics`);

    const second = listingOf(
      await harness.provider.listChanges({ scope, resume: cursorOf(first) }, context),
    );

    expect(
      derivableRemovals({
        listing: second,
        known: knownMirrorOf(first.events ?? []),
        withinWindow: withinCalDAVWindow,
      }),
    ).toEqual(["two@example.com"]);
  }, 30_000);

  test("DAV-O13: the following snapshot removes the resource and nothing else", async () => {
    const harness = createHarness({ resources: collection });
    const scope = scopeOver(marchWindow);
    const context = operationContext(harness.environment, { deadlineMs: 2000 });
    const first = listingOf(await harness.provider.listChanges({ scope, resume: null }, context));
    harness.fake.remove(`${calendarPath}two.ics`);

    const recovered = listingOf(
      await harness.provider.listChanges({ scope, resume: null }, context),
    );

    expect(recovered.kind).toBe("snapshot");
    expect(
      derivableRemovals({
        listing: recovered,
        known: knownMirrorOf(first.events ?? []),
        withinWindow: withinCalDAVWindow,
      }),
    ).toEqual(["two@example.com"]);
  }, 30_000);
});
