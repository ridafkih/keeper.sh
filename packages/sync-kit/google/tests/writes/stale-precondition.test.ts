import { assertConflictNotOverwrite } from "@keeper.sh/sync-conformance";
import { describe, expect, test } from "vitest";
import { outcomeKindOf, outcomeOf } from "../support/expect";
import { createHarness, operationContext } from "../support/harness";
import { createIntent, normalizedOf, timedContent, updateIntent } from "../support/intents";

const createdEvent = async (harness: ReturnType<typeof createHarness>) => {
  const created = outcomeOf(
    await harness.provider.write(
      createIntent(
        "mirror-of-source-1",
        normalizedOf(timedContent()),
        harness.environment.installation.value,
      ),
      operationContext(harness.environment),
    ),
  );
  if (created.kind !== "created") {
    throw new Error(`the create answered "${created.kind}"`);
  }
  return created;
};

describe("a spent precondition is a conflict, never a second write", () => {
  test("GOOG-O39: a spent precondition is a conflict, not a second write", async () => {
    const harness = createHarness();
    const created = await createdEvent(harness);
    const held = created.version;
    await harness.provider.write(
      updateIntent(created.remote.id.value, normalizedOf(timedContent({ title: "first edit" })), held),
      operationContext(harness.environment),
    );

    const replayed = await harness.provider.write(
      updateIntent(
        created.remote.id.value,
        normalizedOf(timedContent({ title: "second edit" })),
        held,
      ),
      operationContext(harness.environment),
    );

    expect(outcomeKindOf(replayed)).toBe("conflict");
    assertConflictNotOverwrite(replayed);
  });

  test("GOOG-O39: the conflict carries the version the calendar actually holds", async () => {
    const harness = createHarness();
    const created = await createdEvent(harness);
    const held = created.version;
    await harness.provider.write(
      updateIntent(created.remote.id.value, normalizedOf(timedContent({ title: "first edit" })), held),
      operationContext(harness.environment),
    );

    const replayed = outcomeOf(
      await harness.provider.write(
        updateIntent(
          created.remote.id.value,
          normalizedOf(timedContent({ title: "second edit" })),
          held,
        ),
        operationContext(harness.environment),
      ),
    );

    if (replayed.kind !== "conflict") {
      throw new Error(`the replay answered "${replayed.kind}"`);
    }
    expect(replayed.observed).not.toEqual({ kind: "matchesVersion", version: held });
  });

  test("GOOG-O39: the stored object was written once, not twice", async () => {
    const harness = createHarness();
    const created = await createdEvent(harness);
    const held = created.version;
    await harness.provider.write(
      updateIntent(created.remote.id.value, normalizedOf(timedContent({ title: "first edit" })), held),
      operationContext(harness.environment),
    );
    await harness.provider.write(
      updateIntent(
        created.remote.id.value,
        normalizedOf(timedContent({ title: "second edit" })),
        held,
      ),
      operationContext(harness.environment),
    );

    expect(harness.fake.items().at(0)?.summary).toBe("first edit");
  });

  test("GOOG-O39: every write the adapter issued carried an If-Match", async () => {
    const harness = createHarness();
    const created = await createdEvent(harness);
    await harness.provider.write(
      updateIntent(
        created.remote.id.value,
        normalizedOf(timedContent({ title: "first edit" })),
        created.version,
      ),
      operationContext(harness.environment),
    );

    const mutations = harness.fake.requests().filter((request) => request.method === "PATCH");
    expect(mutations.length).toBeGreaterThan(0);
    expect(mutations.filter((request) => request.ifMatch === null)).toEqual([]);
  });
});
