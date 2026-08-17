import type { SyncCursor } from "@keeper.sh/sync-protocol";
import { describe, expect, test } from "vitest";
import { cursorOf, listingOf } from "../support/expect";
import { createHarness, marchWindow, operationContext, scopeOver } from "../support/harness";
import { foreignEvent, seedOf } from "../support/items";

const seeded = () => [
  foreignEvent({ uid: "kept", start: "2026-03-08T09:00:00.000Z", end: "2026-03-08T10:00:00.000Z" }),
];

const tamperedWith = (cursor: SyncCursor): SyncCursor => ({
  kind: "syncCursor",
  value: `${cursor.value}-junk`,
  scope: cursor.scope,
});

describe("an undecodable cursor is answered, never thrown", () => {
  test("GOOG-O7: a tampered cursor is cursorLost, not a thrown error", async () => {
    const harness = createHarness();
    harness.fake.seedFromProvider(seedOf(seeded()));
    const scope = scopeOver(marchWindow);
    const minted = cursorOf(
      listingOf(
        await harness.provider.listChanges(
          { scope, resume: null },
          operationContext(harness.environment),
        ),
      ),
    );

    const answered = await harness.provider.listChanges(
      { scope, resume: tamperedWith(minted) },
      operationContext(harness.environment),
    );

    expect(answered.ok).toBe(true);
    expect(listingOf(answered).kind).toBe("cursorLost");
  });

  test("GOOG-O7: an empty cursor value is answered the same way", async () => {
    const harness = createHarness();
    harness.fake.seedFromProvider(seedOf(seeded()));
    const scope = scopeOver(marchWindow);

    const answered = await harness.provider.listChanges(
      { scope, resume: { kind: "syncCursor", value: "", scope } },
      operationContext(harness.environment),
    );

    expect(listingOf(answered).kind).toBe("cursorLost");
  });
});
