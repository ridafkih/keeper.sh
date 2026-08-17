import { assertConflictNotOverwrite } from "@keeper.sh/sync-conformance";
import { describe, expect, test } from "vitest";
import { outcomeKindOf } from "../support/expect";
import { createHarness, operationContext } from "../support/harness";
import { normalizedOf, timedContent, updateIntent, versionOf } from "../support/intents";
import { seedOf, timedItem } from "../support/items";

const mirrored = timedItem({
  id: "id-mirrored",
  uid: "mirrored",
  start: "2026-03-21T09:00:00.0000000",
  end: "2026-03-21T10:00:00.0000000",
  subject: "what the user last wrote",
});

describe("a precondition the server may ignore still cannot become a silent overwrite", () => {
  test("MS-O27: a server that ignores If-Match yields a conflict, never a silent overwrite", async () => {
    const harness = createHarness();
    harness.fake.seedFromProvider(seedOf([]));
    harness.fake.putItems([mirrored]);
    harness.fake.honoursIfMatch(false);
    harness.fake.mutateItem("id-mirrored", { subject: "what the user wrote a second ago" });

    const answered = await harness.provider.write(
      updateIntent(
        "id-mirrored",
        normalizedOf(timedContent({ title: "what our mirror wanted" })),
        versionOf("ck-1-id-mirrored"),
      ),
      operationContext(harness.environment),
    );

    const stored = harness.fake.items().find((item) => item.id === "id-mirrored");
    expect(outcomeKindOf(answered)).toBe("conflict");
    expect(stored?.subject).toBe("what the user wrote a second ago");
    assertConflictNotOverwrite(answered);
  }, 30_000);
});
