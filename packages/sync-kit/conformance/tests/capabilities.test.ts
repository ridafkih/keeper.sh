import type { Capabilities, RemoteEvent } from "@keeper.sh/sync-protocol";
import { describe, expect, test } from "vitest";
import { allDayAs } from "../src/cases/capabilities";
import { referenceCapabilities } from "../src/reference/capabilities";
import { conformanceCaseIds } from "../src/case-id";
import type { CaseGate } from "../src/registry/case";
import { branchNameOf } from "../src/registry/gates";
import { ungatedCaseIds } from "../src/report";
import { selectConformanceCases } from "../src/registry/suite";
import type { CaseSelection } from "../src/registry/suite";
import { failureOf, listChanges, okValue, write } from "./support/drive";
import { referenceHarness, runReferenceCase } from "./support/harness";
import { createIntent, occurrence, scopeOver, spanning, timedAt } from "./support/protocol";

const march = spanning("2026-03-01T00:00:00.000Z", "2026-04-01T00:00:00.000Z");
const scope = scopeOver(march);

const inverted = occurrence(
  "Inverted range",
  timedAt("2026-03-02T10:00:00.000Z", "2026-03-02T09:00:00.000Z"),
);

const zoneIdsOf = (events: readonly RemoteEvent[]): string[] =>
  events.flatMap((event) => {
    const { time } = event.content;
    if (!time) {
      return [];
    }
    if (time.kind === "allDay") {
      return [];
    }
    if (time.zone === null) {
      return [];
    }
    return [time.zone.value];
  });

const refusesEverything: Capabilities<"reference"> = {
  ...referenceCapabilities,
  delta: { kind: "none" },
  deletionAuthority: "explicitRemovalsOnly",
  removalsAreAmbiguous: true,
  provenanceChannel: "none",
  recurrenceWrite: "none",
  echoesWrites: false,
  allDay: "utcMidnightPair",
  representableRange: { ...referenceCapabilities.representableRange, zeroDuration: "reject" },
};

const refusingCapabilities: readonly [string, Capabilities<"reference">][] = [
  ["the reference's own capabilities", referenceCapabilities],
  ["an adapter that refuses everything it can", refusesEverything],
];

const ungatedGate: CaseGate = { kind: "ungated" };

const isAcceptedByIntl = (zone: string): boolean => {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return formatter.resolvedOptions().timeZone.length > 0;
  } catch {
    return false;
  }
};

describe("a declared refusal must actually refuse", () => {
  test("CONF-O29: the ungated case list is non-empty and no capability can remove it", () => {
    const selection = selectConformanceCases(referenceCapabilities);
    const selectedIds = new Set(selection.selected.map((record) => record.id));

    expect(ungatedCaseIds.length).toBeGreaterThan(0);
    expect(ungatedCaseIds.filter((id) => !selectedIds.has(id))).toEqual([]);
  });

  test("CONF-O29: the flagship deletion-safety guarantees are among the ungated cases", () => {
    expect(ungatedCaseIds).toContain("CONF-O1");
    expect(ungatedCaseIds).toContain("CONF-O2");
    expect(ungatedCaseIds).toContain("CONF-O24");
  });

  test.each(refusingCapabilities)(
    "CONF-O29: %s selects a branch and still runs every declared case",
    (_name, supports) => {
      const selection = selectConformanceCases(supports);
      const covered = selection.selected.map((record) => record.id).toSorted();

      expect(covered).toEqual([...conformanceCaseIds].toSorted());
    },
  );

  test("CONF-O29: a refusing capability takes a different branch, never no branch", () => {
    const declining = selectConformanceCases(refusesEverything);
    const accepting = selectConformanceCases(referenceCapabilities);
    const branchOf = (selection: CaseSelection<"reference">, id: string): string | null =>
      branchNameOf(selection.selected.find((record) => record.id === id)?.gate ?? ungatedGate);

    expect(branchOf(declining, "CONF-O11")).toBe("noDelta");
    expect(branchOf(accepting, "CONF-O11")).toBe("windowBoundToCursor");
    expect(branchOf(declining, "CONF-O28")).toBe("reject");
  });

  test("CONF-O35: an unrepresentable construct is refused with its exact constraint", async () => {
    const harness = await referenceHarness();

    const result = await write(
      harness.provider,
      harness.environment,
      createIntent("inverted", inverted),
    );

    expect(failureOf(result).kind).toBe("unrepresentable");
    await harness.dispose();
  });

  test("CONF-O35: an unrepresentable construct is never clamped into a representable one", async () => {
    const harness = await referenceHarness();

    await write(harness.provider, harness.environment, createIntent("inverted", inverted));
    const inspection = await harness.provider.inspect();

    expect(inspection.objects).toEqual([]);
    expect(harness.supports.representableRange.invertedRange).toBe("reject");
    await harness.dispose();
  });

  test("CONF-O43: every zone identifier an adapter returns is accepted by Intl", async () => {
    const harness = await referenceHarness();
    await write(
      harness.provider,
      harness.environment,
      createIntent(
        "zoned",
        occurrence("Zoned", timedAt("2026-03-02T09:00:00.000Z", "2026-03-02T10:00:00.000Z")),
      ),
    );

    const listing = okValue(await listChanges(harness.provider, harness.environment, scope));
    const rejected = zoneIdsOf(listing.events ?? []).filter((zone) => !isAcceptedByIntl(zone));

    expect(rejected).toEqual([]);
    await harness.dispose();
  });

  test("CONF-O43: a Windows zone identifier is refused with constraint zoneIdentifier", async () => {
    const harness = await referenceHarness();
    const windowsZoned = {
      ...occurrence("Windows zoned", {
        kind: "timed" as const,
        start: { kind: "instant" as const, value: "2026-03-02T09:00:00.000Z" },
        end: { kind: "instant" as const, value: "2026-03-02T10:00:00.000Z" },
        zone: { kind: "zoneId" as const, value: "Pacific Standard Time" },
      }),
    };

    const result = await write(
      harness.provider,
      harness.environment,
      createIntent("windows-zoned", windowsZoned),
    );

    expect(failureOf(result).kind).toBe("unrepresentable");
    await harness.dispose();
  });

  test("CONF-O45: an all-day event round-trips in the representation the adapter declared", async () => {
    const harness = await referenceHarness();
    const submitted = allDayAs("all-day", harness.supports.allDay);

    await write(harness.provider, harness.environment, createIntent("all-day", submitted));
    const listing = okValue(await listChanges(harness.provider, harness.environment, scope));
    const mirrored = (listing.events ?? []).find((event) => event.uid.value === "all-day");

    expect(harness.supports.allDay).toBe("dateOnly");
    expect(mirrored?.content.time?.kind).toBe("allDay");
    await harness.dispose();
  });

  test("CONF-O46: a declared throttle status is classified as rateLimited, an undeclared one is not", async () => {
    const harness = await referenceHarness();
    harness.environment.transport.answerWith({
      kind: "status",
      status: 429,
      retryAfter: { kind: "instant", value: "2099-01-01T00:00:00.000Z" },
      times: Number.MAX_SAFE_INTEGER,
    });
    const throttled = await listChanges(harness.provider, harness.environment, scope, null, {
      maxAttempts: 1,
    });
    harness.environment.transport.answerWith({
      kind: "status",
      status: 599,
      retryAfter: null,
      times: Number.MAX_SAFE_INTEGER,
    });
    const rejected = await listChanges(harness.provider, harness.environment, scope, null, {
      maxAttempts: 1,
    });

    expect(failureOf(throttled)).toEqual({
      kind: "rateLimited",
      retryAfter: { kind: "instant", value: "2099-01-01T00:00:00.000Z" },
      scope: "perUser",
    });
    expect(failureOf(rejected).kind).toBe("transport");
    await harness.dispose();
  });

  test("CONF-O45: the generated case passes for the reference provider", async () => {
    await expect(runReferenceCase("CONF-O45")).resolves.toBeUndefined();
  });

  test("CONF-O46: the generated case passes for the reference provider", async () => {
    await expect(runReferenceCase("CONF-O46")).resolves.toBeUndefined();
  });

  test("CONF-O29: the generated case passes for the reference provider", async () => {
    await expect(runReferenceCase("CONF-O29")).resolves.toBeUndefined();
  });

  test("CONF-O35: the generated case passes for the reference provider", async () => {
    await expect(runReferenceCase("CONF-O35")).resolves.toBeUndefined();
  });

  test("CONF-O43: the generated case passes for the reference provider", async () => {
    await expect(runReferenceCase("CONF-O43")).resolves.toBeUndefined();
  });
});
