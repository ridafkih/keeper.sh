import { describe, expect, test } from "vitest";
import { ReconcileInternalDataError, planReconciliation } from "../../src/index";
import {
  foreignEvent,
  knownEvent,
  knownState,
  mapping,
  mappingSet,
  policy,
  remoteId,
  slotIdentity,
  snapshotListing,
  sourceOnly,
  uid,
} from "../support/fixtures";

const identity = slotIdentity("evt-1", "2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z");

const hostileProviderShapes = [
  ["an empty uid", foreignEvent({ id: "evt-hostile", uid: "" })],
  ["a title of ten thousand characters", foreignEvent({ id: "evt-long", uid: "evt-long", title: "x".repeat(10_000) })],
  ["a NUL byte inside the uid", foreignEvent({ id: "evt-nul", uid: `a${String.fromCodePoint(0)}b` })],
  ["a negative revision", foreignEvent({ id: "evt-neg", uid: "evt-neg", revision: -1 })],
  ["a non-finite revision", foreignEvent({ id: "evt-nan", uid: "evt-nan", revision: Number.NaN })],
] as const;

describe("provider-shaped input never throws, our own broken invariants do", () => {
  for (const entry of hostileProviderShapes) {
    const [name, event] = entry;

    test(`RECON-I27: ${name} is reported, not thrown`, () => {
      expect(() =>
        planReconciliation(
          sourceOnly(snapshotListing({ events: [event] })),
          knownState([knownEvent({ identity })]),
          mappingSet([mapping({ identity, destinationId: "mirror-1" })]),
          policy(),
        ),
      ).not.toThrow();
    });
  }

  test("RECON-I27: a hostile item still leaves a trace in unresolved", () => {
    const plan = planReconciliation(
      sourceOnly(snapshotListing({ events: [hostileProviderShapes[0][1]] })),
      knownState([knownEvent({ identity })]),
      mappingSet([mapping({ identity, destinationId: "mirror-1" })]),
      policy(),
    );

    expect(plan.unresolved.length).toBeGreaterThan(0);
  });

  test("RECON-I27: two mappings claiming one source identity is our invariant, and it fails loud", () => {
    const duplicated = mappingSet([
      mapping({ identity, destinationId: "mirror-1" }),
      mapping({ identity, destinationId: "mirror-2" }),
    ]);

    expect(() =>
      planReconciliation(
        sourceOnly(snapshotListing({ events: [] })),
        knownState([knownEvent({ identity })]),
        duplicated,
        policy(),
      ),
    ).toThrow(ReconcileInternalDataError);
  });

  test("RECON-I27: a known state whose calendar disagrees with its rows fails loud", () => {
    const mismatched = {
      ...knownState([knownEvent({ identity })]),
      calendar: {
        provider: "somewhere-else",
        account: { kind: "accountId" as const, value: "other" },
        calendar: { kind: "calendarId" as const, value: "other" },
      },
    };

    expect(() =>
      planReconciliation(
        sourceOnly(snapshotListing({ events: [] })),
        mismatched,
        mappingSet([]),
        policy(),
      ),
    ).toThrow(ReconcileInternalDataError);
  });

  test("RECON-I27: a mapping pointing at a foreign destination calendar fails loud", () => {
    const elsewhere = mappingSet([
      {
        ...mapping({ identity, destinationId: "mirror-elsewhere" }),
        destinationCalendar: {
          provider: "microsoft",
          account: { kind: "accountId", value: "acct-destination" },
          calendar: { kind: "calendarId", value: "cal-somewhere-else" },
        },
      },
    ]);

    expect(() =>
      planReconciliation(
        sourceOnly(snapshotListing({ events: [foreignEvent({ id: "evt-1", uid: "evt-1" })] })),
        knownState([knownEvent({ identity })]),
        elsewhere,
        policy(),
      ),
    ).toThrow(ReconcileInternalDataError);
  });

  test("RECON-I27: the internal error names the invariant it broke", () => {
    const duplicated = mappingSet([
      mapping({ identity, destinationId: "mirror-1" }),
      mapping({ identity, destinationId: "mirror-2" }),
    ]);

    expect(() =>
      planReconciliation(
        sourceOnly(snapshotListing({ events: [] })),
        knownState([knownEvent({ identity })]),
        duplicated,
        policy(),
      ),
    ).toThrow(/mapping/i);
  });

  test("RECON-I27: a duplicate removal in a provider payload is tolerated, not thrown", () => {
    expect(() =>
      planReconciliation(
        sourceOnly(
          snapshotListing({
            removals: [
              { kind: "deleted", id: remoteId("evt-1"), uid: uid("evt-1") },
              { kind: "deleted", id: remoteId("evt-1"), uid: uid("evt-1") },
            ],
          }),
        ),
        knownState([knownEvent({ identity })]),
        mappingSet([mapping({ identity, destinationId: "mirror-1" })]),
        policy(),
      ),
    ).not.toThrow();
  });
});
