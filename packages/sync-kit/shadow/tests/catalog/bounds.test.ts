import { describe, expect, test } from "vitest";
import { defaultShadowLimits, renderCatalog, truncationMarker } from "../../src/index";
import type { ShadowLimits } from "../../src/index";
import { catalogOfPlan, cataloged } from "../support/scenario";
import { planWith, retireTombstone } from "../support/plans";
import { slotIdentity } from "../support/fixtures";

const identityNumbered = (index: number) =>
  slotIdentity(`evt-${index}`, "2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z");

const identitiesUpTo = (count: number) =>
  Array.from({ length: count }, (_unused, index) => identityNumbered(index));

const catalogOfTombstones = (count: number) => {
  const identities = identitiesUpTo(count);
  return cataloged(
    catalogOfPlan(
      identities,
      planWith({
        tombstones: identities.map((identity) => retireTombstone(identity, "absentFromSnapshot")),
      }),
    ),
  );
};

const smallLimits: ShadowLimits = {
  deletionSampleCount: 4,
  deletionSampleBytes: 4096,
  contextSampleCount: 2,
  contextSampleBytes: 1024,
  identifierBytes: 32,
};

const sampleOf = (value: unknown): string => {
  if (typeof value !== "string") {
    throw new TypeError(`expected a string sample, got ${typeof value}`);
  }
  return value;
};

describe("identifier lists are a capped sample beside an uncapped count", () => {
  test("SHADOW-I27: exactly on the sample limit keeps the whole list", () => {
    const rendered = renderCatalog(catalogOfTombstones(4), smallLimits);
    const sample = sampleOf(rendered["shadow.deletions.sample"]);

    expect(rendered["shadow.deletions.total"]).toBe(4);
    for (const index of [0, 1, 2, 3]) {
      expect(sample).toContain(`evt-${index}`);
    }
  });

  test("SHADOW-I27: one past the limit reports the remainder in the total", () => {
    const rendered = renderCatalog(catalogOfTombstones(5), smallLimits);
    const sample = sampleOf(rendered["shadow.deletions.sample"]);
    const sampled = sample.split(",").filter((part) => part.length > 0);

    expect(rendered["shadow.deletions.total"]).toBe(5);
    expect(sampled.length).toBe(4);
    expect(rendered["shadow.deletions.sample_omitted"]).toBe(1);
  });

  test("SHADOW-I27: a complete deletion sample says nothing was omitted", () => {
    const rendered = renderCatalog(catalogOfTombstones(4), smallLimits);

    expect(rendered["shadow.deletions.sample_omitted"]).toBe(0);
  });

  test("SHADOW-I16: a sampled deletion names the remote id and the handle, not only the identity", () => {
    const rendered = renderCatalog(catalogOfTombstones(1), defaultShadowLimits);
    const sample = sampleOf(rendered["shadow.deletions.sample"]);

    expect(sample).toContain("mirror-evt-0");
    expect(sample).toContain("handle-evt-0");
    expect(sample).toContain("observedListing");
  });

  test("SHADOW-I27: a nine-thousand-character identifier is truncated with a marker", () => {
    const long = slotIdentity(
      "x".repeat(9000),
      "2026-03-10T09:00:00.000Z",
      "2026-03-10T10:00:00.000Z",
    );
    const rendered = renderCatalog(
      cataloged(
        catalogOfPlan([long], planWith({ tombstones: [retireTombstone(long, "absentFromSnapshot")] })),
      ),
      smallLimits,
    );
    const sample = sampleOf(rendered["shadow.deletions.sample"]);

    expect(sample).toContain(truncationMarker);
    expect(sample.length).toBeLessThan(9000);
    expect(rendered["shadow.deletions.total"]).toBe(1);
  });

  test("SHADOW-I27: a repeated identifier is counted once", () => {
    const one = identityNumbered(0);
    const rendered = renderCatalog(
      cataloged(
        catalogOfPlan(
          [one],
          planWith({
            tombstones: [
              retireTombstone(one, "absentFromSnapshot"),
              retireTombstone(one, "absentFromSnapshot"),
            ],
          }),
        ),
      ),
      smallLimits,
    );
    const sample = sampleOf(rendered["shadow.deletions.sample"]);
    const occurrences = sample.split("evt-0").length - 1;

    expect(occurrences).toBe(1);
  });

  test("SHADOW-I27: a missing optional field is omitted, not emitted as undefined", () => {
    const rendered = renderCatalog(catalogOfTombstones(1), defaultShadowLimits);

    expect(Object.hasOwn(rendered, "shadow.not_translated_reason")).toBe(false);
    for (const value of Object.values(rendered)) {
      expect(value).toBeDefined();
    }
  });

  test("SHADOW-I27: every rendered value is a boolean, a number or a string", () => {
    const rendered = renderCatalog(catalogOfTombstones(3), defaultShadowLimits);

    for (const value of Object.values(rendered)) {
      expect(["boolean", "number", "string"]).toContain(typeof value);
    }
  });

  test("SHADOW-I27: deletions get a larger budget than context sections", () => {
    expect(defaultShadowLimits.deletionSampleCount).toBeGreaterThan(
      defaultShadowLimits.contextSampleCount,
    );
    expect(defaultShadowLimits.deletionSampleBytes).toBeGreaterThan(
      defaultShadowLimits.contextSampleBytes,
    );

    const rendered = renderCatalog(catalogOfTombstones(64), defaultShadowLimits);
    const sample = sampleOf(rendered["shadow.deletions.sample"]);

    expect(sample.split(",").filter((part) => part.length > 0).length).toBe(64);
  });
});
