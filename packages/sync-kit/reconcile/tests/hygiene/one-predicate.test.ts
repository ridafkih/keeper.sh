import type { EventTime, TimeWindow, WindowMembership } from "@keeper.sh/sync-protocol";
import { describe, expect, test } from "vitest";
import { foreignEvent, knownEvent, knownState, mappingSet, policy, slotIdentity, snapshotListing, sourceOnly } from "../support/fixtures";
import { planFor } from "../support/scenario";
import { filesMatching, sourceFiles } from "../support/sources";

const icalSpecifier = ["@keeper.sh", "sync-ical"].join("/");
const valueImportOfIcal = `from "${icalSpecifier}"`;
const typeOnlyImportOfIcal = `import type`;

const countingMembership = (): { readonly predicate: WindowMembership; calls: () => number } => {
  const seen: { readonly window: TimeWindow; readonly time: EventTime }[] = [];
  const predicate: WindowMembership = (window: TimeWindow, time: EventTime): boolean => {
    seen.push({ window, time });
    return true;
  };
  return { predicate, calls: () => seen.length };
};

const admitsNothing: WindowMembership = () => false;

const scenarioWithPredicate = (predicate: WindowMembership) => {
  const identity = slotIdentity("evt-1", "2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z");
  return {
    observed: sourceOnly(snapshotListing({ events: [foreignEvent({ id: "evt-1", uid: "evt-1" })] })),
    known: knownState([knownEvent({ identity })]),
    mappings: mappingSet([]),
    policy: policy({ withinWindow: predicate }),
  };
};

describe("exactly one window predicate", () => {
  test("RECON-I33: only the policy module imports sync-ical for a value", async () => {
    const importers = await filesMatching("src", valueImportOfIcal);
    const nonTypeImporters: string[] = [];
    for (const file of importers) {
      const text = await Bun.file(new URL(`../../${file}`, import.meta.url).pathname).text();
      const valueLine = text
        .split("\n")
        .find((line) => line.includes(valueImportOfIcal) && !line.startsWith(typeOnlyImportOfIcal));
      if (valueLine) {
        nonTypeImporters.push(file);
      }
    }

    expect(nonTypeImporters).toEqual(["src/policy.ts"]);
  });

  test("RECON-I33: no module under src/plan re-derives window membership", async () => {
    const arithmetic = await filesMatching("src/plan", "Date.parse");
    const files = await sourceFiles("src/plan");

    expect(arithmetic).toEqual([]);
    expect(files.length).toBeGreaterThan(5);
  });

  test("RECON-I33: the injected predicate is the one the planner consults", () => {
    const counting = countingMembership();

    planFor(scenarioWithPredicate(counting.predicate));

    expect(counting.calls()).toBeGreaterThan(0);
  });

  test("RECON-I33: a predicate that admits nothing produces no window-driven tombstone", () => {
    const plan = planFor(scenarioWithPredicate(admitsNothing));

    expect(plan.tombstones.map((tombstone) => tombstone.cause)).not.toContain("absentFromSnapshot");
  });
});
