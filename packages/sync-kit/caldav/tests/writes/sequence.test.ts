import { describe, expect, test } from "vitest";
import { listingOf, outcomeOf } from "../support/expect";
import { createHarness, marchWindow, operationContext, scopeOver } from "../support/harness";
import { createIntent, normalizedOf, timedContent, updateIntent } from "../support/intents";

const revisionsIn = (data: string): readonly string[] =>
  data.split("\r\n").filter((line) => line.startsWith("SEQUENCE:"));

describe("a write orders itself against every other client's copy", () => {
  test("DAV-O70: a create writes SEQUENCE:1 and an applied update advances it", async () => {
    const harness = createHarness();
    const context = operationContext(harness.environment, { deadlineMs: 2000 });
    const created = outcomeOf(
      await harness.provider.write(
        createIntent("seq-one", normalizedOf(timedContent()), "keeper-tests"),
        context,
      ),
    );
    if (created.kind !== "created") {
      throw new Error(`a create answered "${created.kind}"`);
    }
    const afterCreate = harness.fake.resourceAt(created.remote.id.value)?.data ?? "";

    outcomeOf(
      await harness.provider.write(
        updateIntent(
          created.remote.id.value,
          normalizedOf(timedContent({ title: "Renamed" })),
          created.version,
        ),
        context,
      ),
    );
    const afterUpdate = harness.fake.resourceAt(created.remote.id.value)?.data ?? "";

    expect(revisionsIn(afterCreate)).toEqual(["SEQUENCE:1"]);
    expect(revisionsIn(afterUpdate)).toEqual(["SEQUENCE:2"]);
  }, 30_000);

  test("DAV-O70: the revision the adapter reads back is the SEQUENCE it wrote", async () => {
    const harness = createHarness();
    const context = operationContext(harness.environment, { deadlineMs: 2000 });
    const created = outcomeOf(
      await harness.provider.write(
        createIntent("seq-two", normalizedOf(timedContent()), "keeper-tests"),
        context,
      ),
    );
    if (created.kind !== "created") {
      throw new Error(`a create answered "${created.kind}"`);
    }
    outcomeOf(
      await harness.provider.write(
        updateIntent(
          created.remote.id.value,
          normalizedOf(timedContent({ title: "Renamed" })),
          created.version,
        ),
        context,
      ),
    );

    const listing = listingOf(
      await harness.provider.listChanges({ scope: scopeOver(marchWindow), resume: null }, context),
    );

    expect((listing.events ?? []).map((event) => event.revision)).toEqual([2]);
  }, 30_000);
});
