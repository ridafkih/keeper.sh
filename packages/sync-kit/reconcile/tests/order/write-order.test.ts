import type { PlannedWrite } from "../../src/index";
import { describe, expect, test } from "vitest";
import { comparePlannedWrites, planReconciliation } from "../../src/index";
import {
  foreignEvent,
  instant,
  knownEvent,
  knownState,
  mapping,
  mappingSet,
  policy,
  slotIdentity,
  snapshotListing,
  sourceOnly,
  timedAt,
  version,
  writableDestination,
} from "../support/fixtures";

const spanFor = (index: number) => ({
  start: `2026-03-1${index}T09:00:00.000Z`,
  end: `2026-03-1${index}T10:00:00.000Z`,
});

const identityA = slotIdentity("evt-a", "2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z");
const identityB = slotIdentity("evt-b", "2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z");

const retireAt = (at: string, identity: typeof identityA): PlannedWrite => ({
  kind: "single",
  at: instant(at),
  identity,
  intent: {
    kind: "delete",
    calendar: writableDestination,
    target: { kind: "deleteHandle", value: `handle-${identity.uid.value}` },
    precondition: { kind: "matchesVersion", version: version("v1") },
    reason: "sourceDeleted",
  },
});

const createAt = (at: string, identity: typeof identityA): PlannedWrite => ({
  kind: "single",
  at: instant(at),
  identity,
  intent: {
    kind: "create",
    calendar: writableDestination,
    idempotencyKey: { kind: "idempotencyKey", value: `key-${identity.uid.value}` },
    content: {
      kind: "normalized",
      provider: "microsoft",
      content: {
        title: identity.uid.value,
        description: null,
        location: null,
        availability: "busy",
        visibility: "default",
        recurrence: null,
        time: timedAt("2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z"),
      },
      fingerprint: { kind: "fingerprint", value: `fp-${identity.uid.value}` },
    },
    provenance: { kind: "ours", installation: { kind: "installationId", value: "install-ours" } },
    precondition: { kind: "absent" },
  },
});

describe("the total order the plan arrives in", () => {
  test("RECON-I23: an earlier instant sorts before a later one", () => {
    expect(
      comparePlannedWrites(
        createAt("2026-03-10T09:00:00.000Z", identityA),
        createAt("2026-03-11T09:00:00.000Z", identityA),
      ),
    ).toBeLessThan(0);
  });

  test("RECON-I23: at the same instant, a retire sorts before a create", () => {
    expect(
      comparePlannedWrites(
        retireAt("2026-03-10T09:00:00.000Z", identityA),
        createAt("2026-03-10T09:00:00.000Z", identityB),
      ),
    ).toBeLessThan(0);
  });

  test("RECON-I23: at the same instant and the same kind, the identity key breaks the tie", () => {
    expect(
      comparePlannedWrites(
        createAt("2026-03-10T09:00:00.000Z", identityA),
        createAt("2026-03-10T09:00:00.000Z", identityB),
      ),
    ).toBeLessThan(0);
  });

  test("RECON-I23: the comparator is antisymmetric and reflexive", () => {
    const left = createAt("2026-03-10T09:00:00.000Z", identityA);
    const right = retireAt("2026-03-10T09:00:00.000Z", identityB);

    expect(comparePlannedWrites(left, left)).toBe(0);
    expect(Math.sign(comparePlannedWrites(left, right))).toBe(-Math.sign(comparePlannedWrites(right, left)));
  });

  test("RECON-I23: the plan arrives already sorted by that comparator", () => {
    const identities = [1, 2, 3, 4].map((index) =>
      slotIdentity(`evt-${index}`, spanFor(index).start, spanFor(index).end),
    );

    const plan = planReconciliation(
      sourceOnly(
        snapshotListing({
          events: [1, 2].map((index) =>
            foreignEvent({
              id: `evt-${index}`,
              uid: `evt-${index}`,
              time: timedAt(spanFor(index).start, spanFor(index).end),
              fingerprint: `fp-new-${index}`,
            }),
          ),
        }),
      ),
      knownState(identities.map((identity) => knownEvent({ identity, fingerprint: "fp-old" }))),
      mappingSet(
        identities.map((identity, index) =>
          mapping({ identity, destinationId: `mirror-${index}`, sourceFingerprint: "fp-old" }),
        ),
      ),
      policy(),
    );

    expect(plan.writes).toEqual([...plan.writes].toSorted(comparePlannedWrites));
  });
});
