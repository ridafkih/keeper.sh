import { describe, expect, test } from "vitest";
import { conformanceCaseIds } from "../src/case-id";
import { selectConformanceCases } from "../src/registry/suite";
import { referenceCapabilities } from "../src/reference/capabilities";
import { listChanges } from "./support/drive";
import { referenceHarness, runReferenceCase } from "./support/harness";
import { foreignEvent, scopeOver, seedOf, spanning } from "./support/protocol";

const march = spanning("2026-03-01T00:00:00.000Z", "2026-04-01T00:00:00.000Z");
const scope = scopeOver(march);

const seeded = [
  foreignEvent({
    uid: "alpha",
    title: "Alpha",
    start: "2026-03-02T09:00:00.000Z",
    end: "2026-03-02T10:00:00.000Z",
  }),
];

const lockupCaseIds = new Set(conformanceCaseIds.filter((id) => id.startsWith("CONF-L")));

describe("the injected seams were actually used", () => {
  test("CONF-L13: a nominal operation goes through the injected transport", async () => {
    const harness = await referenceHarness();
    await harness.provider.seed(seedOf(seeded, []));

    await listChanges(harness.provider, harness.environment, scope);

    expect(harness.environment.transport.callCount()).toBeGreaterThan(0);
    await harness.dispose();
  });

  test("CONF-L13: a nominal operation reads the injected clock", async () => {
    const harness = await referenceHarness();
    await harness.provider.seed(seedOf(seeded, []));
    const before = harness.environment.clock.nowCount();

    await listChanges(harness.provider, harness.environment, scope);

    expect(harness.environment.clock.nowCount()).toBeGreaterThan(before);
    await harness.dispose();
  });

  test("CONF-L13: the anti-vacuity case runs before every other lockup case", () => {
    const selection = selectConformanceCases(referenceCapabilities);
    const lockups = selection.selected
      .map((record) => record.id)
      .filter((id) => lockupCaseIds.has(id));

    expect(lockups.at(0)).toBe("CONF-L13");
  });

  test("CONF-L13: an adapter that ignores the injected seams fails the case", async () => {
    const harness = await referenceHarness();
    await harness.provider.seed(seedOf(seeded, []));
    const untouched = harness.environment.transport.callCount();

    expect(untouched).toBe(0);
    await expect(runReferenceCase("CONF-L13")).resolves.toBeUndefined();
    await harness.dispose();
  });
});
