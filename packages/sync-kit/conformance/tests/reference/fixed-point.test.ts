import { describe, expect, test } from "vitest";
import {
  conflictingOn,
  expiringCursorAfter,
  stallingOn,
  truncatingAfter,
  undecorated,
} from "../../src/fixtures";
import type { ProviderDecorator } from "../../src/fixtures";
import { referenceCapabilities } from "../../src/reference/capabilities";
import { selectConformanceCases } from "../../src/registry/suite";
import { failureOf, listChanges, okValue, write } from "../support/drive";
import { referenceHarness, runCaseAgainst } from "../support/harness";
import {
  createIntent,
  foreignEvent,
  occurrence,
  scopeOver,
  seedOf,
  spanning,
  timedAt,
} from "../support/protocol";

const march = spanning("2026-03-01T00:00:00.000Z", "2026-04-01T00:00:00.000Z");
const scope = scopeOver(march);

const seeded = [
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
];

const mirrored = occurrence(
  "Mirrored",
  timedAt("2026-03-04T09:00:00.000Z", "2026-03-04T10:00:00.000Z"),
);

const decorators: readonly [string, () => ProviderDecorator, string][] = [
  ["bare", () => undecorated, "snapshot"],
  ["truncatingAfter(1)", () => truncatingAfter(1), "partial"],
  ["expiringCursorAfter(1)", () => expiringCursorAfter(1), "snapshot"],
  [
    "conflictingOn(create)",
    () => conflictingOn((intent) => intent.kind === "create"),
    "snapshot",
  ],
  ["stallingOn(write)", () => stallingOn((operation) => operation === "write"), "snapshot"],
];

describe("the reference provider is adversarial about its own success", () => {
  test("CONF-I55: list, apply, list, apply reaches a fixed point with zero further writes", async () => {
    const harness = await referenceHarness();
    await harness.provider.seed(seedOf(seeded));

    await listChanges(harness.provider, harness.environment, scope);
    await write(harness.provider, harness.environment, createIntent("mirrored", mirrored));
    const afterApply = await harness.provider.inspect();
    await listChanges(harness.provider, harness.environment, scope);
    await listChanges(harness.provider, harness.environment, scope);
    const afterConvergence = await harness.provider.inspect();

    expect(afterConvergence.writeLog).toEqual(afterApply.writeLog);
    await harness.dispose();
  });

  test("CONF-I55: the reference passes every selected case when run bare", async () => {
    const harness = await referenceHarness();
    const selection = selectConformanceCases(referenceCapabilities);
    const failures: string[] = [];

    for (const record of selection.selected) {
      const settled = await Promise.allSettled([
        runCaseAgainst(record.id, harness.provider, harness.environment, harness.supports),
      ]);
      for (const outcome of settled) {
        if (outcome.status === "rejected") {
          failures.push(`${record.id}: ${String(outcome.reason)}`);
        }
      }
    }

    expect(failures).toEqual([]);
    await harness.dispose();
  });

  test("CONF-I55: a listing is byte-identical across two polls of unchanged input", async () => {
    const harness = await referenceHarness();
    await harness.provider.seed(seedOf(seeded));

    const first = okValue(await listChanges(harness.provider, harness.environment, scope));
    const second = okValue(await listChanges(harness.provider, harness.environment, scope));

    expect(second.events).toEqual(first.events);
    expect(second.withheld).toEqual(first.withheld);
    await harness.dispose();
  });

  test.each(decorators)(
    "CONF-I55: the %s fixture answers a first listing as exactly the kind it promises",
    async (_name, decorate, expected) => {
      const harness = await referenceHarness(decorate());
      await harness.provider.seed(seedOf(seeded));

      const result = await listChanges(harness.provider, harness.environment, scope);

      expect(okValue(result).kind).toBe(expected);
      await harness.dispose();
    },
  );

  test("CONF-I55: the expiringCursorAfter(1) fixture loses the cursor on the poll after the first", async () => {
    const harness = await referenceHarness(expiringCursorAfter(1));
    await harness.provider.seed(seedOf(seeded));

    const first = okValue(await listChanges(harness.provider, harness.environment, scope));
    const resumed = await listChanges(
      harness.provider,
      harness.environment,
      scope,
      first.cursor ?? null,
    );

    expect(okValue(resumed).kind).toBe("cursorLost");
    await harness.dispose();
  });

  test("CONF-I55: the conflictingOn(create) fixture turns a create into a typed conflict", async () => {
    const harness = await referenceHarness(conflictingOn((intent) => intent.kind === "create"));

    const answered = await write(
      harness.provider,
      harness.environment,
      createIntent("mirrored", mirrored),
    );

    expect(okValue(answered).kind).toBe("conflict");
    await harness.dispose();
  });

  test("CONF-I55: the stallingOn(write) fixture settles a write at its deadline, never never", async () => {
    const harness = await referenceHarness(stallingOn((operation) => operation === "write"));

    const answered = await write(
      harness.provider,
      harness.environment,
      createIntent("mirrored", mirrored),
      { deadlineMs: 20 },
    );

    expect(failureOf(answered)).toEqual({ kind: "notAttempted", reason: "budgetExhausted" });
    await harness.dispose();
  });

  test("CONF-I55: disposing the reference provider releases every timer it armed", async () => {
    const harness = await referenceHarness();
    await harness.provider.seed(seedOf(seeded));
    await listChanges(harness.provider, harness.environment, scope);

    await harness.dispose();

    expect(harness.environment.clock.pendingTimers()).toBe(0);
  });
});
