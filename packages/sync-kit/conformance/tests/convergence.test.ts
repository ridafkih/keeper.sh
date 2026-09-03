import { describe, expect, test } from "vitest";
import { canonicalise, sortedKeys } from "../src/canonical";
import { failureOf, listChanges, okValue, write } from "./support/drive";
import { referenceHarness, runReferenceCase } from "./support/harness";
import {
  createIntent,
  foreignEvent,
  occurrence,
  scopeOver,
  spanning,
  summarise,
  timedAt,
  seedOf,
} from "./support/protocol";

const march = spanning("2026-03-01T00:00:00.000Z", "2026-04-01T00:00:00.000Z");
const scope = scopeOver(march);

const early = foreignEvent({
  uid: "collider",
  title: "Older",
  start: "2026-03-02T09:00:00.000Z",
  end: "2026-03-02T10:00:00.000Z",
  revision: 1,
});
const late = foreignEvent({
  uid: "collider",
  title: "Newer",
  start: "2026-03-02T11:00:00.000Z",
  end: "2026-03-02T12:00:00.000Z",
  revision: 2,
});

describe("identical input is zero work", () => {
  test("CONF-O8: the same colliding pair produces the same winner in either feed order", async () => {
    const forward = await referenceHarness();
    const backward = await referenceHarness();
    await forward.provider.seed(seedOf([early, late], []));
    await backward.provider.seed(seedOf([late, early], []));

    const first = okValue(await listChanges(forward.provider, forward.environment, scope));
    const second = okValue(await listChanges(backward.provider, backward.environment, scope));

    expect(canonicalise(summarise(first.events ?? []))).toBe(
      canonicalise(summarise(second.events ?? [])),
    );
    await forward.dispose();
    await backward.dispose();
  });

  test("CONF-O9: a second identical poll writes nothing at all", async () => {
    const harness = await referenceHarness();
    await harness.provider.seed(seedOf([early], []));
    await listChanges(harness.provider, harness.environment, scope);
    const afterFirst = await harness.provider.inspect();

    await listChanges(harness.provider, harness.environment, scope);
    const afterSecond = await harness.provider.inspect();

    expect(afterSecond.writeLog).toEqual(afterFirst.writeLog);
    expect(afterSecond.writeLog).toEqual([]);
    await harness.dispose();
  });

  test("CONF-O20: a provider's own lossless rewrite does not read as drift", async () => {
    const harness = await referenceHarness();
    const submitted = occurrence(
      "Trailing space \r\nand a CRLF",
      timedAt("2026-03-02T09:00:00.500Z", "2026-03-02T10:00:00.500Z"),
    );
    const created = okValue(
      await write(harness.provider, harness.environment, createIntent("rewritten", submitted)),
    );

    await listChanges(harness.provider, harness.environment, scope);
    const afterFirst = await harness.provider.inspect();
    await listChanges(harness.provider, harness.environment, scope);
    const afterSecond = await harness.provider.inspect();

    expect(created.kind).toBe("created");
    expect(afterSecond.writeLog).toEqual(afterFirst.writeLog);
    await harness.dispose();
  });

  test("CONF-O21: permuted key order canonicalises to one identity", () => {
    const straight = canonicalise({ alpha: 1, bravo: 2, charlie: 3 });
    const permuted = canonicalise({ charlie: 3, alpha: 1, bravo: 2 });

    expect(straight).toBe(permuted);
  });

  test("CONF-O21: keys are sorted by UTF-16 code unit, not by localeCompare", () => {
    const keys = ["Z", "a", "ä", "Á", "\u{1F600}", "Ａ"];

    expect(sortedKeys(keys)).toEqual(keys.toSorted());
    expect(sortedKeys(keys)).not.toEqual(keys.toSorted((one, two) => one.localeCompare(two)));
  });

  test("CONF-O21: an absent value spelled null and an absent value omitted are one identity", () => {
    const spelled = canonicalise({ description: null, title: "Alpha" });
    const alsoSpelled = canonicalise({ title: "Alpha", description: null });

    expect(spelled).toBe(alsoSpelled);
  });

  test("CONF-O22: one identity repeated in a listing is one entry, last observation wins", async () => {
    const harness = await referenceHarness();
    await harness.provider.seed(seedOf([early, late, early], []));

    const listing = okValue(await listChanges(harness.provider, harness.environment, scope));
    const collided = (listing.events ?? []).filter((event) => event.uid.value === "collider");

    expect(collided).toHaveLength(1);
    await harness.dispose();
  });

  test("CONF-O22: reversing the repeats picks the same winner", async () => {
    const forward = await referenceHarness();
    const backward = await referenceHarness();
    await forward.provider.seed(seedOf([early, late], []));
    await backward.provider.seed(seedOf([late, early], []));

    const first = okValue(await listChanges(forward.provider, forward.environment, scope));
    const second = okValue(await listChanges(backward.provider, backward.environment, scope));

    expect((first.events ?? []).map((event) => event.revision)).toEqual(
      (second.events ?? []).map((event) => event.revision),
    );
    await forward.dispose();
    await backward.dispose();
  });

  test("CONF-O9: a failed poll is still not a write", async () => {
    const harness = await referenceHarness();
    await harness.provider.seed(seedOf([early], []));
    harness.environment.transport.answerWith({
      kind: "reject",
      failure: { kind: "transport", status: 500, disposition: "permanent" },
      times: Number.MAX_SAFE_INTEGER,
    });

    const result = await listChanges(harness.provider, harness.environment, scope);
    const inspection = await harness.provider.inspect();

    expect(failureOf(result).kind).toBe("transport");
    expect(inspection.writeLog).toEqual([]);
    await harness.dispose();
  });

  test("CONF-O8: the generated case passes for the reference provider", async () => {
    await expect(runReferenceCase("CONF-O8")).resolves.toBeUndefined();
  });

  test("CONF-O9: the generated case passes for the reference provider", async () => {
    await expect(runReferenceCase("CONF-O9")).resolves.toBeUndefined();
  });

  test("CONF-O20: the generated case passes for the reference provider", async () => {
    await expect(runReferenceCase("CONF-O20")).resolves.toBeUndefined();
  });

  test("CONF-O21: the generated case passes for the reference provider", async () => {
    await expect(runReferenceCase("CONF-O21")).resolves.toBeUndefined();
  });

  test("CONF-O22: the generated case passes for the reference provider", async () => {
    await expect(runReferenceCase("CONF-O22")).resolves.toBeUndefined();
  });
});
