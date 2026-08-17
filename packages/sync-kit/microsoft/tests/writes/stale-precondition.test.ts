import { assertConflictNotOverwrite } from "@keeper.sh/sync-conformance";
import { describe, expect, test } from "vitest";
import { outcomeKindOf } from "../support/expect";
import { createHarness, operationContext } from "../support/harness";
import { normalizedOf, timedContent, updateIntent, versionOf } from "../support/intents";
import { seedOf, timedItem } from "../support/items";

describe("a stale etag is a conflict, and it writes nothing", () => {
  test("MS-O28: a stale etag is a typed conflict and writes nothing", async () => {
    const harness = createHarness();
    harness.fake.seedFromProvider(seedOf([]));
    harness.fake.putItems([
      timedItem({
        id: "id-moved",
        uid: "moved",
        start: "2026-03-21T09:00:00.0000000",
        end: "2026-03-21T10:00:00.0000000",
        subject: "the copy we read",
      }),
    ]);
    harness.fake.mutateItem("id-moved", { subject: "the copy the user moved" });
    const before = harness.fake.items();

    const answered = await harness.provider.write(
      updateIntent(
        "id-moved",
        normalizedOf(timedContent({ title: "the copy we wanted" })),
        versionOf("ck-1-id-moved"),
      ),
      operationContext(harness.environment),
    );

    expect(outcomeKindOf(answered)).toBe("conflict");
    expect(harness.fake.items()).toEqual(before);
    assertConflictNotOverwrite(answered);
  }, 30_000);

  test("MS-O28: the conflict carries the version it actually observed", async () => {
    const harness = createHarness();
    harness.fake.seedFromProvider(seedOf([]));
    harness.fake.putItems([
      timedItem({
        id: "id-moved",
        uid: "moved",
        start: "2026-03-21T09:00:00.0000000",
        end: "2026-03-21T10:00:00.0000000",
      }),
    ]);
    harness.fake.mutateItem("id-moved", { subject: "moved again" });

    const answered = await harness.provider.write(
      updateIntent("id-moved", normalizedOf(timedContent()), versionOf("ck-1-id-moved")),
      operationContext(harness.environment),
    );

    if (!answered.ok || answered.value.kind !== "conflict") {
      throw new Error("a stale write did not answer a typed conflict");
    }
    expect(answered.value.observed.kind).toBe("matchesVersion");
  }, 30_000);
});
