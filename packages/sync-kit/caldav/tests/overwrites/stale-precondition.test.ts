import { describe, expect, test } from "vitest";
import { listingOf, outcomeKindOf } from "../support/expect";
import { calendarPath } from "../support/fake-caldav";
import { createHarness, decadeWindow, operationContext, scopeOver } from "../support/harness";
import { normalizedOf, timedContent, updateIntent } from "../support/intents";
import { singleEventResource } from "../support/resources";

describe("a stale If-Match is a conflict, never an overwrite", () => {
  test("DAV-O39: a stale If-Match yields conflict, and the resource on the server is unchanged", async () => {
    const harness = createHarness({
      fake: { honoursIfMatch: true },
      resources: [singleEventResource("one.ics", { uid: "one@example.com", summary: "Theirs" })],
    });
    const context = operationContext(harness.environment, { deadlineMs: 2000 });
    const listed = listingOf(
      await harness.provider.listChanges({ scope: scopeOver(decadeWindow), resume: null }, context),
    );
    const [event] = listed.events ?? [];
    if (!event) {
      throw new Error("the listing described no event to update");
    }
    harness.fake.put(
      `${calendarPath}one.ics`,
      singleEventResource("one.ics", { uid: "one@example.com", summary: "Moved by the user" }).data,
    );

    const written = await harness.provider.write(
      updateIntent(event.id.value, normalizedOf(timedContent({ title: "Ours" })), event.version),
      context,
    );

    expect(outcomeKindOf(written)).toBe("conflict");
    expect(harness.fake.resourceAt(`${calendarPath}one.ics`)?.data).toContain("Moved by the user");
  }, 30_000);

  test("DAV-O39: the conflict reports the precondition that was observed", async () => {
    const harness = createHarness({
      resources: [singleEventResource("one.ics", { uid: "one@example.com" })],
    });
    const context = operationContext(harness.environment, { deadlineMs: 2000 });
    const listed = listingOf(
      await harness.provider.listChanges({ scope: scopeOver(decadeWindow), resume: null }, context),
    );
    const [event] = listed.events ?? [];
    if (!event) {
      throw new Error("the listing described no event to update");
    }
    harness.fake.bumpEtag(`${calendarPath}one.ics`);

    const written = await harness.provider.write(
      updateIntent(event.id.value, normalizedOf(timedContent()), event.version),
      context,
    );

    if (!written.ok || written.value.kind !== "conflict") {
      throw new Error(`a stale precondition answered "${outcomeKindOf(written)}"`);
    }
    expect(written.value.observed.kind).toBe("matchesVersion");
  }, 30_000);
});
