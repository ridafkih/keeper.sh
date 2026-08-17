import { describe, expect, test } from "vitest";
import type { CalendarKey } from "@keeper.sh/sync-protocol";
import type { Plan, SourceIdentity } from "@keeper.sh/sync-reconcile";
import { calendarKeyString } from "@keeper.sh/sync-reconcile";
import { defaultShadowLimits, renderCatalog, truncationMarker } from "../../src/index";
import type { PlanUnit, ShadowLimits } from "../../src/index";
import { cataloged, runShadow } from "../support/scenario";
import { planWith, retireTombstone } from "../support/plans";
import {
  destinationSnapshot,
  mirrorRow,
  overrideIdentity,
  ownMirrorEvent,
  shadowOptions,
  slotIdentity,
  sourceCalendarA,
  sourceCalendarB,
  storedCoverage,
  storedSourceEvent,
  syncInput,
  witnessFor,
} from "../support/fixtures";

const identityNamed = (uid: string): SourceIdentity =>
  slotIdentity(uid, "2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z");

const manyIdentities = (count: number): readonly SourceIdentity[] =>
  Array.from({ length: count }, (_unused, index) => identityNamed(`evt-${index}`));

const inputOverIdentities = (identities: readonly SourceIdentity[]) =>
  syncInput({
    storedSourceEvents: identities.map((identity) => storedSourceEvent({ identity })),
    mirrors: identities.map((identity) =>
      mirrorRow({
        identity,
        destinationId: `mirror-${identity.uid.value}`,
        destinationHandle: `handle-${identity.uid.value}`,
      }),
    ),
    destinationListing: destinationSnapshot({
      events: identities.map((identity) =>
        ownMirrorEvent({
          id: `mirror-${identity.uid.value}`,
          uid: identity.uid.value,
          deleteHandle: `handle-${identity.uid.value}`,
        }),
      ),
    }),
  });

const planOverIdentities = (identities: readonly SourceIdentity[]): Plan =>
  planWith({
    tombstones: identities.map((identity) => retireTombstone(identity, "absentFromSnapshot")),
  });

const sampleOf = (value: unknown): string => {
  if (typeof value !== "string") {
    throw new TypeError(`expected a string sample, got ${typeof value}`);
  }
  return value;
};

const countingPlanner = (): {
  readonly plan: PlanUnit;
  readonly calls: readonly CalendarKey[];
} => {
  const calls: CalendarKey[] = [];
  const plan: PlanUnit = (unit) => {
    calls.push(unit.sourceCalendar);
    return planWith({});
  };
  return { plan, calls };
};

const mappedSources = (count: number): readonly CalendarKey[] =>
  Array.from({ length: count }, (_unused, index) => ({
    provider: "google",
    account: { kind: "accountId", value: `acct-${index}` },
    calendar: { kind: "calendarId", value: `cal-${index}` },
  }));

const multiSourceInput = (sources: readonly CalendarKey[]) =>
  syncInput({
    mappedSourceCalendars: sources,
    witness: witnessFor(sources),
    storedCoverage: sources.map((calendar) => storedCoverage({ calendar })),
    storedSourceEvents: [],
    mirrors: [],
  });

describe("every walk is bounded in the input size", () => {
  test("SHADOW-L4: a plan with fifty thousand tombstones renders within the limits", () => {
    const identities = [
      ...manyIdentities(50_000),
      identityNamed(`evt-${"y".repeat(9000)}`),
    ];
    const catalog = cataloged(
      runShadow(
        inputOverIdentities(identities),
        shadowOptions({ plan: () => planOverIdentities(identities) }),
      ),
    );
    const rendered = renderCatalog(catalog, defaultShadowLimits);
    const sample = sampleOf(rendered["shadow.deletions.sample"]);
    const sampled = sample.split(",").filter((part) => part.length > 0);
    const encoder = new TextEncoder();

    expect(rendered["shadow.deletions.total"]).toBe(50_001);
    expect(sampled.length).toBe(defaultShadowLimits.deletionSampleCount);
    expect(encoder.encode(sample).length).toBeLessThanOrEqual(
      defaultShadowLimits.deletionSampleBytes,
    );
    for (const value of Object.values(rendered)) {
      expect(["boolean", "number", "string"]).toContain(typeof value);
    }
  }, 60_000);

  test("SHADOW-L4: the bound that stopped the sample is the configured one", () => {
    const identities = manyIdentities(500);
    const catalog = cataloged(
      runShadow(
        inputOverIdentities(identities),
        shadowOptions({ plan: () => planOverIdentities(identities) }),
      ),
    );
    const tighter: ShadowLimits = { ...defaultShadowLimits, deletionSampleCount: 10 };
    const tightSample = sampleOf(renderCatalog(catalog, tighter)["shadow.deletions.sample"]);
    const wideSample = sampleOf(
      renderCatalog(catalog, defaultShadowLimits)["shadow.deletions.sample"],
    );

    expect(tightSample.split(",").filter((part) => part.length > 0).length).toBe(10);
    expect(wideSample.split(",").filter((part) => part.length > 0).length).toBe(200);
  }, 30_000);

  test("SHADOW-L5: the planner is invoked exactly once per mapped source calendar", () => {
    const three = mappedSources(3);
    const counterForThree = countingPlanner();
    runShadow(multiSourceInput(three), shadowOptions({ plan: counterForThree.plan }));

    expect(counterForThree.calls.length).toBe(3);
    expect(new Set(counterForThree.calls.map((key) => calendarKeyString(key))).size).toBe(3);

    const four = mappedSources(4);
    const counterForFour = countingPlanner();
    runShadow(multiSourceInput(four), shadowOptions({ plan: counterForFour.plan }));

    expect(counterForFour.calls.length).toBe(4);
  });

  test("SHADOW-L5: the planner is never called for a source it was not given", () => {
    const counter = countingPlanner();
    runShadow(
      multiSourceInput([sourceCalendarA]),
      shadowOptions({ plan: counter.plan }),
    );
    const seen = counter.calls.map((key) => calendarKeyString(key));

    expect(seen).toEqual([calendarKeyString(sourceCalendarA)]);
    expect(seen).not.toContain(calendarKeyString(sourceCalendarB));
  });

  test("SHADOW-L6: one pathological identifier does not consume the whole byte budget", () => {
    const pathological = identityNamed("z".repeat(9000));
    const normal = manyIdentities(50);
    const identities = [pathological, ...normal];
    const catalog = cataloged(
      runShadow(
        inputOverIdentities(identities),
        shadowOptions({ plan: () => planOverIdentities(identities) }),
      ),
    );
    const sample = sampleOf(
      renderCatalog(catalog, defaultShadowLimits)["shadow.deletions.sample"],
    );

    expect(sample).toContain(truncationMarker);
    for (const identity of normal) {
      expect(sample).toContain(identity.uid.value);
    }
  }, 30_000);

  test("SHADOW-L6: the truncated identifier is cut at exactly the configured identifier bound", () => {
    const pathological = identityNamed("z".repeat(9000));
    const catalog = cataloged(
      runShadow(
        inputOverIdentities([pathological]),
        shadowOptions({ plan: () => planOverIdentities([pathological]) }),
      ),
    );
    const encoder = new TextEncoder();
    const narrow = renderCatalog(
      catalog,
      { ...defaultShadowLimits, identifierBytes: 64 },
    );
    const wide = renderCatalog(catalog, { ...defaultShadowLimits, identifierBytes: 512 });

    expect(encoder.encode(sampleOf(narrow["shadow.deletions.sample"])).length).toBeLessThanOrEqual(
      64 + encoder.encode(truncationMarker).length,
    );
    expect(encoder.encode(sampleOf(wide["shadow.deletions.sample"])).length).toBeGreaterThan(64);
  });

  test("SHADOW-L7: a degenerate override chain terminates", () => {
    const selfReferential = overrideIdentity("evt-loop", "2026-03-10T09:00:00.000Z");
    const slotOne = slotIdentity(
      "evt-pair",
      "2026-03-10T09:00:00.000Z",
      "2026-03-10T10:00:00.000Z",
    );
    const slotTwo = slotIdentity(
      "evt-pair",
      "2026-03-10T10:00:00.000Z",
      "2026-03-10T09:00:00.000Z",
    );
    const identities = [selfReferential, slotOne, slotTwo];
    const catalog = cataloged(
      runShadow(
        syncInput({
          storedSourceEvents: identities.map((identity) => storedSourceEvent({ identity })),
          mirrors: identities.map((identity, index) =>
            mirrorRow({
              identity,
              destinationId: `mirror-loop-${index}`,
              destinationHandle: `handle-loop-${index}`,
            }),
          ),
          destinationListing: destinationSnapshot({
            events: identities.map((identity, index) =>
              ownMirrorEvent({
                id: `mirror-loop-${index}`,
                uid: identity.uid.value,
                deleteHandle: `handle-loop-${index}`,
              }),
            ),
          }),
        }),
        shadowOptions({ plan: () => planOverIdentities(identities) }),
      ),
    );

    expect(catalog.deletions.length).toBe(3);
    expect(new Set(catalog.deletions.map((entry) => entry.identityKey)).size).toBe(3);
  }, 10_000);
});
