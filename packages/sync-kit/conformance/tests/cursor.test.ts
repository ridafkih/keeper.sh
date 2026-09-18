import type { ChangeListing, ListingScope, SyncCursor } from "@keeper.sh/sync-protocol";
import { describe, expect, test } from "vitest";
import { expiringCursorAfter, truncatingAfter } from "../src/fixtures";
import { failureOf, listChanges, listingKindOf, okValue } from "./support/drive";
import { referenceHarness, runReferenceCase } from "./support/harness";
import { foreignEvent, scopeOver, seedOf, spanning } from "./support/protocol";

const march = spanning("2026-03-01T00:00:00.000Z", "2026-04-01T00:00:00.000Z");
const quarter = spanning("2026-01-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z");
const scope = scopeOver(march);
const widerScope = scopeOver(quarter);

const events = [
  foreignEvent({
    uid: "alpha",
    title: "Alpha",
    start: "2026-03-02T09:00:00.000Z",
    end: "2026-03-02T10:00:00.000Z",
  }),
  foreignEvent({
    uid: "bravo",
    title: "Bravo",
    start: "2026-03-03T09:00:00.000Z",
    end: "2026-03-03T10:00:00.000Z",
  }),
  foreignEvent({
    uid: "charlie",
    title: "Charlie",
    start: "2026-03-04T09:00:00.000Z",
    end: "2026-03-04T10:00:00.000Z",
  }),
];

const cursorOf = (listing: ChangeListing): SyncCursor | null => listing.cursor ?? null;

const cursorValueOf = (listing: ChangeListing): string => {
  const cursor = cursorOf(listing);
  if (cursor === null) {
    return "no-cursor";
  }
  return cursor.value;
};

const scopeOfCursor = (listing: ChangeListing): ListingScope => {
  const cursor = cursorOf(listing);
  if (cursor === null) {
    return listing.scope;
  }
  return cursor.scope;
};

describe("a cursor is opaque, scoped, and never advanced past unapplied work", () => {
  test("CONF-O10: an expired cursor mid-pagination yields cursorLost and no tombstones", async () => {
    const harness = await referenceHarness(expiringCursorAfter(1));
    await harness.provider.seed(seedOf(events, []));
    const first = okValue(await listChanges(harness.provider, harness.environment, scope));

    const second = await listChanges(
      harness.provider,
      harness.environment,
      scope,
      cursorOf(first),
    );

    expect(listingKindOf(second)).toBe("cursorLost");
    expect(okValue(second).removals).toBeUndefined();
    expect(okValue(second).events).toBeUndefined();
    await harness.dispose();
  });

  test("CONF-O10: cursorLost is never expressed as an empty delta", async () => {
    const harness = await referenceHarness(expiringCursorAfter(1));
    await harness.provider.seed(seedOf(events, []));
    const first = okValue(await listChanges(harness.provider, harness.environment, scope));

    const second = okValue(
      await listChanges(harness.provider, harness.environment, scope, cursorOf(first)),
    );

    expect(second.kind).not.toBe("delta");
    expect(second.cursor).toBeUndefined();
    await harness.dispose();
  });

  test("CONF-O11: a cursor minted under a narrow window is refused when the window widens", async () => {
    const harness = await referenceHarness();
    await harness.provider.seed(seedOf(events, []));
    const narrow = okValue(await listChanges(harness.provider, harness.environment, scope));

    const widened = await listChanges(
      harness.provider,
      harness.environment,
      widerScope,
      cursorOf(narrow),
    );

    expect(["cursorLost", "failure:cursorInvalid"]).toContain(listingKindOf(widened));
    expect(harness.supports.delta).toEqual({ kind: "tokenized", windowBoundToCursor: true });
    await harness.dispose();
  });

  test("CONF-O24: a truncated read never returns a sync cursor", async () => {
    const harness = await referenceHarness(truncatingAfter(1));
    await harness.provider.seed(seedOf(events, []));

    const listing = okValue(await listChanges(harness.provider, harness.environment, scope));

    expect(cursorValueOf(listing)).toBe("no-cursor");
    await harness.dispose();
  });

  test("CONF-O24: an aborted run never returns a sync cursor", async () => {
    const harness = await referenceHarness();
    await harness.provider.seed(seedOf(events, []));
    const caller = new AbortController();
    caller.abort();

    const result = await listChanges(harness.provider, harness.environment, scope, null, {
      signal: caller.signal,
    });

    expect(failureOf(result).kind).toBe("notAttempted");
    await harness.dispose();
  });

  test("CONF-O24: a transport failure never returns a sync cursor", async () => {
    const harness = await referenceHarness();
    await harness.provider.seed(seedOf(events, []));
    harness.environment.transport.answerWith({
      kind: "reject",
      failure: { kind: "transport", status: 500, disposition: "permanent" },
      times: Number.MAX_SAFE_INTEGER,
    });

    const result = await listChanges(harness.provider, harness.environment, scope);

    expect(failureOf(result).kind).toBe("transport");
    await harness.dispose();
  });

  test("CONF-O37: a quiet calendar still advances its cursor while writing nothing", async () => {
    const harness = await referenceHarness();
    await harness.provider.seed(seedOf(events, []));
    const first = okValue(await listChanges(harness.provider, harness.environment, scope));

    const second = okValue(
      await listChanges(harness.provider, harness.environment, scope, cursorOf(first)),
    );
    const inspection = await harness.provider.inspect();

    expect(cursorValueOf(second)).not.toBe(cursorValueOf(first));
    expect(cursorValueOf(second)).not.toBe("no-cursor");
    expect(inspection.writeLog).toEqual([]);
    await harness.dispose();
  });

  test("CONF-O38: a sparse delta item never blanks the fields it omits", async () => {
    await expect(runReferenceCase("CONF-O38")).resolves.toBeUndefined();
  });

  test("CONF-O40: a cursor whose bytes were mutated yields cursorLost, never a throw", async () => {
    const harness = await referenceHarness();
    await harness.provider.seed(seedOf(events, []));
    const first = okValue(await listChanges(harness.provider, harness.environment, scope));
    const mutated = {
      kind: "syncCursor" as const,
      value: `${cursorValueOf(first)}-tampered`,
      scope: scopeOfCursor(first),
    };

    const replayed = await listChanges(harness.provider, harness.environment, scope, mutated);

    expect(["cursorLost", "failure:cursorInvalid"]).toContain(listingKindOf(replayed));
    await harness.dispose();
  });

  test("CONF-O40: the suite never parses the cursor it was handed", async () => {
    const harness = await referenceHarness();
    await harness.provider.seed(seedOf(events, []));

    const listing = okValue(await listChanges(harness.provider, harness.environment, scope));

    expect(typeof cursorValueOf(listing)).toBe("string");
    expect(cursorValueOf(listing)).not.toContain("2026-03-01");
    await harness.dispose();
  });

  test("CONF-O10: the generated case passes for the reference provider", async () => {
    await expect(runReferenceCase("CONF-O10", expiringCursorAfter(1))).resolves.toBeUndefined();
  });

  test("CONF-O11: the generated case passes for the reference provider", async () => {
    await expect(runReferenceCase("CONF-O11")).resolves.toBeUndefined();
  });

  test("CONF-O24: the generated case passes for the reference provider", async () => {
    await expect(runReferenceCase("CONF-O24", truncatingAfter(1))).resolves.toBeUndefined();
  });

  test("CONF-O37: the generated case passes for the reference provider", async () => {
    await expect(runReferenceCase("CONF-O37")).resolves.toBeUndefined();
  });

  test("CONF-O40: the generated case passes for the reference provider", async () => {
    await expect(runReferenceCase("CONF-O40")).resolves.toBeUndefined();
  });
});
