import { assertConflictNotOverwrite } from "@keeper.sh/sync-conformance";
import { describe, expect, test } from "vitest";
import { outcomeKindOf } from "../support/expect";
import { createHarness, operationContext } from "../support/harness";
import { deleteIntent, versionOf } from "../support/intents";
import { seedOf, timedItem } from "../support/items";

const mirrored = timedItem({
  id: "id-mirrored",
  uid: "mirrored",
  start: "2026-03-21T09:00:00.0000000",
  end: "2026-03-21T10:00:00.0000000",
  subject: "what the user last wrote",
});

describe("a removal cannot destroy a revision the caller never observed", () => {
  test("MS-O44: a server that ignores If-Match yields a conflict rather than deleting a newer event", async () => {
    const harness = createHarness();
    harness.fake.seedFromProvider(seedOf([]));
    harness.fake.putItems([mirrored]);
    harness.fake.honoursIfMatch(false);
    harness.fake.mutateItem("id-mirrored", { subject: "what the user wrote a second ago" });

    const answered = await harness.provider.write(
      deleteIntent("id-mirrored", versionOf("ck-1-id-mirrored")),
      operationContext(harness.environment),
    );

    const stored = harness.fake.items().find((item) => item.id === "id-mirrored");
    expect(outcomeKindOf(answered)).toBe("conflict");
    expect(stored?.subject).toBe("what the user wrote a second ago");
    assertConflictNotOverwrite(answered);
  }, 30_000);

  test("MS-O45: a removal whose precondition still matches deletes the event", async () => {
    const harness = createHarness();
    harness.fake.seedFromProvider(seedOf([]));
    harness.fake.putItems([mirrored]);
    harness.fake.honoursIfMatch(false);

    const answered = await harness.provider.write(
      deleteIntent("id-mirrored", versionOf("ck-1-id-mirrored")),
      operationContext(harness.environment),
    );

    expect(outcomeKindOf(answered)).toBe("deleted");
    expect(harness.fake.items().find((item) => item.id === "id-mirrored")).toBeUndefined();
  }, 30_000);
});
