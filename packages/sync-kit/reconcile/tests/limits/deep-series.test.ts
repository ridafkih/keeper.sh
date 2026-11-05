import { describe, expect, test } from "vitest";
import { planReconciliation } from "../../src/index";
import type { KnownEvent, Mapping } from "../../src/index";
import {
  foreignEvent,
  knownEvent,
  knownState,
  mapping,
  mappingSet,
  overrideIdentity,
  policy,
  snapshotListing,
  sourceOnly,
  timedAt,
} from "../support/fixtures";

const chainDepth = 10_000;

const occurrenceInstant = (index: number): string =>
  new Date(Date.UTC(2026, 2, 1, 9, 0, 0) + index * 60_000).toISOString();

const chainedOverrides = (depth: number): readonly KnownEvent[] =>
  Array.from({ length: depth }, (unused, index) =>
    knownEvent({
      identity: overrideIdentity("deep-series", occurrenceInstant(index)),
      recurring: true,
      time: timedAt(occurrenceInstant(index), occurrenceInstant(index + 1)),
    }),
  );

const chainedMappings = (depth: number): readonly Mapping[] =>
  Array.from({ length: depth }, (unused, index) =>
    mapping({
      identity: overrideIdentity("deep-series", occurrenceInstant(index)),
      destinationId: `mirror-${index}`,
    }),
  );

describe("a very deep series is walked, never recursed", () => {
  test("RECON-L8: a ten-thousand-deep override chain returns a plan rather than blowing the stack", () => {
    const plan = planReconciliation(
      sourceOnly(snapshotListing({ events: [] })),
      knownState(chainedOverrides(chainDepth)),
      mappingSet(chainedMappings(chainDepth)),
      policy(),
    );

    expect(plan.tombstones).toHaveLength(chainDepth);
  }, 60_000);

  test("RECON-L8: the same depth observed rather than absent also returns", () => {
    const events = Array.from({ length: chainDepth }, (unused, index) =>
      foreignEvent({
        id: `deep-${index}`,
        uid: "deep-series",
        time: timedAt(occurrenceInstant(index), occurrenceInstant(index + 1)),
        fingerprint: `fp-${index}`,
      }),
    );

    const plan = planReconciliation(
      sourceOnly(snapshotListing({ events })),
      knownState(chainedOverrides(chainDepth)),
      mappingSet(chainedMappings(chainDepth)),
      policy(),
    );

    expect(plan).toBeDefined();
  }, 60_000);

  test("RECON-L8: doubling the depth still returns, so no depth-proportional stack is used", () => {
    const plan = planReconciliation(
      sourceOnly(snapshotListing({ events: [] })),
      knownState(chainedOverrides(chainDepth * 2)),
      mappingSet(chainedMappings(chainDepth * 2)),
      policy(),
    );

    expect(plan.tombstones).toHaveLength(chainDepth * 2);
  }, 120_000);

  test("RECON-L8: no top-level function under src calls itself", async () => {
    const { readSource, sourceFiles } = await import("../support/sources");
    const files = await sourceFiles("src");
    const selfCalling: string[] = [];

    for (const file of files) {
      const text = await readSource(file);
      for (const declaration of text.split(/\n(?=const )/)) {
        const [, name] = /^const (\w+) = /.exec(declaration) ?? [];
        if (!name) {
          continue;
        }
        if (declaration.slice(declaration.indexOf("=>")).includes(`${name}(`)) {
          selfCalling.push(`${file}:${name}`);
        }
      }
    }

    expect(selfCalling).toEqual([]);
    expect(files.length).toBeGreaterThan(15);
  });
});
