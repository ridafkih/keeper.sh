import type { BoundedSample, ListingDiagnostics } from "@keeper.sh/sync-protocol";
import { describe, expect, test } from "vitest";
import { assertNoContentInDiagnostics } from "../src/assertions/listing";
import { conformanceLimits } from "../src/limits";
import { listChanges, okValue, write } from "./support/drive";
import { referenceHarness, runReferenceCase } from "./support/harness";
import {
  createIntent,
  foreignEvent,
  occurrence,
  scopeOver,
  spanning,
  timedAt,
  seedOf,
} from "./support/protocol";

const march = spanning("2026-03-01T00:00:00.000Z", "2026-04-01T00:00:00.000Z");
const scope = scopeOver(march);

const secretTitle = "Board comp review with Alex";
const secretLocation = "Room 12, 4th floor";
const secretDescription = "salary bands attached";

const secretiveEvent = {
  ...occurrence(secretTitle, timedAt("2026-03-02T09:00:00.000Z", "2026-03-02T10:00:00.000Z")),
  description: secretDescription,
  location: secretLocation,
};

const benign = foreignEvent({
  uid: "benign",
  title: "Benign",
  start: "2026-03-03T09:00:00.000Z",
  end: "2026-03-03T10:00:00.000Z",
});

const manyWithheld = [...Array.from({ length: 2000 }).keys()].map((index) =>
  foreignEvent({
    uid: `withheld-${index}`,
    title: `Withheld ${index}`,
    start: "2026-03-04T10:00:00.000Z",
    end: "2026-03-04T09:00:00.000Z",
  }),
);

const samplesOf = (diagnostics: ListingDiagnostics): readonly BoundedSample[] => [
  diagnostics.withheld,
  diagnostics.selfAuthored,
  diagnostics.unrepresentable,
];

const utf16LengthOf = (sample: BoundedSample): number =>
  sample.sample.reduce((total, entry) => total + entry.length, 0);

describe("diagnostics are bounded, exact, and carry no content", () => {
  test("CONF-O19: no event title, description or location ever appears in diagnostics", async () => {
    const harness = await referenceHarness();
    await write(
      harness.provider,
      harness.environment,
      createIntent("secretive", secretiveEvent),
    );

    const listing = okValue(await listChanges(harness.provider, harness.environment, scope));

    expect(() =>
      assertNoContentInDiagnostics(listing, [secretTitle, secretDescription, secretLocation]),
    ).not.toThrow();
    await harness.dispose();
  });

  test("CONF-O19: the leak scan actually fires when content is present", async () => {
    const harness = await referenceHarness();
    await harness.provider.seed(seedOf([benign], []));
    const listing = okValue(await listChanges(harness.provider, harness.environment, scope));

    expect(() => assertNoContentInDiagnostics(listing, ["benign"])).toThrow();
    await harness.dispose();
  });

  test("CONF-O30: a clean listing reports all-zero totals", async () => {
    const harness = await referenceHarness();
    await harness.provider.seed(seedOf([benign], []));

    const listing = okValue(await listChanges(harness.provider, harness.environment, scope));

    expect(samplesOf(listing.diagnostics).map((sample) => sample.total)).toEqual([0, 0, 0]);
    await harness.dispose();
  });

  test("CONF-O30: self-authored and unrepresentable are counted separately", async () => {
    const harness = await referenceHarness();
    const unrepresentable = foreignEvent({
      uid: "inverted",
      title: "Inverted",
      start: "2026-03-05T10:00:00.000Z",
      end: "2026-03-05T09:00:00.000Z",
    });
    await harness.provider.seed(seedOf([unrepresentable], []));
    await write(harness.provider, harness.environment, createIntent("ours", secretiveEvent));

    const listing = okValue(await listChanges(harness.provider, harness.environment, scope));

    expect(listing.diagnostics.selfAuthored.total).toBe(1);
    expect(listing.diagnostics.unrepresentable.total).toBe(1);
    await harness.dispose();
  });

  test("CONF-O30: two identical polls produce identical diagnostics including sample order", async () => {
    const harness = await referenceHarness();
    await harness.provider.seed(seedOf(manyWithheld.slice(0, 5), []));

    const first = okValue(await listChanges(harness.provider, harness.environment, scope));
    const second = okValue(await listChanges(harness.provider, harness.environment, scope));

    expect(second.diagnostics).toEqual(first.diagnostics);
    await harness.dispose();
  });

  test("CONF-O31: the sample is bounded by entry count while the total stays exact", async () => {
    const harness = await referenceHarness();
    await harness.provider.seed(seedOf(manyWithheld, []));

    const listing = okValue(await listChanges(harness.provider, harness.environment, scope));

    expect(listing.diagnostics.withheld.total).toBe(manyWithheld.length);
    expect(listing.diagnostics.withheld.sample.length).toBeLessThanOrEqual(
      conformanceLimits.diagnosticSampleEntries,
    );
    await harness.dispose();
  });

  test("CONF-O31: the sample is bounded by total UTF-16 length, not only entry count", async () => {
    const harness = await referenceHarness();
    const pathological = foreignEvent({
      uid: "x".repeat(50_000),
      title: "Pathological identifier",
      start: "2026-03-06T10:00:00.000Z",
      end: "2026-03-06T09:00:00.000Z",
    });
    await harness.provider.seed(seedOf([pathological], []));

    const listing = okValue(await listChanges(harness.provider, harness.environment, scope));

    expect(utf16LengthOf(listing.diagnostics.withheld)).toBeLessThanOrEqual(
      conformanceLimits.diagnosticSampleUtf16Length,
    );
    await harness.dispose();
  });

  test("CONF-O32: a discard with neither uid nor start is still reported as missingIdentity", async () => {
    await expect(runReferenceCase("CONF-O32")).resolves.toBeUndefined();
  });

  test("CONF-O42: a failed run leaks no diagnostics into the run that follows it", async () => {
    const harness = await referenceHarness();
    await harness.provider.seed(seedOf([benign], []));
    harness.environment.transport.answerWith({
      kind: "reject",
      failure: { kind: "transport", status: 500, disposition: "permanent" },
      times: 8,
    });
    await listChanges(harness.provider, harness.environment, scope);

    harness.environment.transport.answerWith({ kind: "pass" });
    const recovered = okValue(await listChanges(harness.provider, harness.environment, scope));

    expect(recovered.diagnostics.pagesFetched).toBeGreaterThan(0);
    expect(samplesOf(recovered.diagnostics).map((sample) => sample.total)).toEqual([0, 0, 0]);
    await harness.dispose();
  });

  test("CONF-O30: the generated case passes for the reference provider", async () => {
    await expect(runReferenceCase("CONF-O30")).resolves.toBeUndefined();
  });

  test("CONF-O31: the generated case passes for the reference provider", async () => {
    await expect(runReferenceCase("CONF-O31")).resolves.toBeUndefined();
  });

  test("CONF-O42: the generated case passes for the reference provider", async () => {
    await expect(runReferenceCase("CONF-O42")).resolves.toBeUndefined();
  });
});
