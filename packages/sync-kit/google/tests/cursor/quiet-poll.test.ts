import { describe, expect, test } from "vitest";
import { cursorOf, listingOf } from "../support/expect";
import { createHarness, marchWindow, operationContext, scopeOver } from "../support/harness";
import { foreignEvent, seedOf } from "../support/items";

const seeded = () => [
  foreignEvent({ uid: "still", start: "2026-03-09T09:00:00.000Z", end: "2026-03-09T10:00:00.000Z" }),
];

const writeMethods = new Set(["POST", "PATCH", "PUT", "DELETE"]);

describe("a poll that finds nothing still moves the frontier", () => {
  test("GOOG-O8: a poll that finds nothing mints a new cursor and issues no write", async () => {
    const harness = createHarness();
    harness.fake.seedFromProvider(seedOf(seeded()));
    const scope = scopeOver(marchWindow);
    const first = listingOf(
      await harness.provider.listChanges(
        { scope, resume: null },
        operationContext(harness.environment),
      ),
    );

    const quiet = listingOf(
      await harness.provider.listChanges(
        { scope, resume: cursorOf(first) },
        operationContext(harness.environment),
      ),
    );

    expect(quiet.kind).toBe("delta");
    expect(cursorOf(quiet).value).not.toBe(cursorOf(first).value);
    expect(harness.fake.requests().filter((request) => writeMethods.has(request.method))).toEqual([]);
  });

  test("GOOG-O8: a failed poll hands back no cursor at all", async () => {
    const harness = createHarness();
    harness.fake.seedFromProvider(seedOf(seeded()));
    const scope = scopeOver(marchWindow);
    const first = listingOf(
      await harness.provider.listChanges(
        { scope, resume: null },
        operationContext(harness.environment),
      ),
    );
    harness.fake.failListOn({
      onCall: 2,
      status: 500,
      reason: "backendError",
      bodyShape: "json",
    });

    const failed = await harness.provider.listChanges(
      { scope, resume: cursorOf(first) },
      operationContext(harness.environment),
    );

    expect(failed.ok).toBe(false);
  });
});
