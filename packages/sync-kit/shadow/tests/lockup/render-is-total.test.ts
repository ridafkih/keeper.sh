import { describe, expect, test } from "vitest";
import { tombstoneCauses, unresolvedReasons } from "@keeper.sh/sync-reconcile";
import {
  catalogCaveats,
  coverageProofRefusals,
  defaultShadowLimits,
  renderCatalog,
  signatureOf,
  translationRefusals,
} from "../../src/index";
import type { Catalog } from "../../src/index";
import { destinationCalendar, sourceCalendarA } from "../support/fixtures";
import { deleteHandle, instant, remoteId, uid } from "../support/handles";

const isLoggable = (rendered: Record<string, unknown>): boolean =>
  Object.values(rendered).every((value) =>
    ["boolean", "number", "string"].includes(typeof value),
  );

const identityKeyOf = (value: string): string => signatureOf(["master", value]);

const notTranslatedArms = (): readonly Catalog[] =>
  translationRefusals.map((reason) => ({
    kind: "notTranslated",
    destination: destinationCalendar,
    reason,
    detail: `refused because ${reason}`,
  }));

const plannerRefusedArm = (): Catalog => ({
  kind: "plannerRefused",
  destination: destinationCalendar,
  sourceCalendar: sourceCalendarA,
  invariant: "two mappings claim the source identity evt-one",
});

const shadowRefusedArm = (): Catalog => ({
  kind: "shadowRefused",
  destination: destinationCalendar,
  invariant: "a planned removal names the source identity evt-one, which no mapping claims",
});

const catalogedArms = (): readonly Catalog[] =>
  tombstoneCauses.flatMap((cause) =>
    coverageProofRefusals.map((refusal): Catalog => ({
      kind: "cataloged",
      destination: destinationCalendar,
      deletions: [
        {
          origin: "tombstone",
          cause,
          identityKey: identityKeyOf(`evt-${cause}`),
          uid: uid(`evt-${cause}`),
          recurrence: { kind: "master" },
          remoteEventId: remoteId(`mirror-${cause}`),
          deleteHandle: deleteHandle(`handle-${cause}`),
          handleSource: "observedListing",
          time: {
            kind: "occurrence",
            time: {
              kind: "timed",
              start: instant("2026-03-10T09:00:00.000Z"),
              end: instant("2026-03-10T10:00:00.000Z"),
              zone: null,
            },
          },
          sourceCalendar: sourceCalendarA,
          destinationCalendar,
          preconditionKind: "matchesVersion",
          licensedBy: "proven",
          signature: `sig-${cause}`,
        },
      ],
      replacements: [],
      creations: [],
      updates: [],
      forgottenLocalRows: [],
      unresolved: unresolvedReasons.map((reason) => ({
        reason,
        identityKey: identityKeyOf(`evt-${reason}`),
        id: remoteId(`mirror-${reason}`),
        sourceCalendar: sourceCalendarA,
      })),
      coverage: [
        {
          sourceCalendar: sourceCalendarA,
          kind: "unproven",
          refusal,
          listingKind: "partial",
          recordedAt: null,
          ageSeconds: null,
          cursor: { kind: "hold", reason: "listingIncomplete" },
        },
      ],
      caveats: catalogCaveats,
      identitiesConsidered: 1,
    })),
  );

const everyArm = (): readonly Catalog[] => [
  ...notTranslatedArms(),
  plannerRefusedArm(),
  shadowRefusedArm(),
  ...catalogedArms(),
];

describe("rendering is total", () => {
  test("SHADOW-L8: every catalog shape renders without throwing", () => {
    const arms = everyArm();

    expect(arms.length).toBeGreaterThan(
      translationRefusals.length + tombstoneCauses.length * coverageProofRefusals.length - 1,
    );
    for (const arm of arms) {
      const rendered = renderCatalog(arm, defaultShadowLimits);

      expect(isLoggable({ ...rendered })).toBe(true);
      expect(rendered["shadow.outcome"]).toBe(arm.kind);
    }
  });

  test("SHADOW-L8: a rendered catalog is never empty, so a log line is never a silent drop", () => {
    for (const arm of everyArm()) {
      expect(Object.keys(renderCatalog(arm, defaultShadowLimits)).length).toBeGreaterThan(0);
    }
  });

  test("SHADOW-L8: every unresolved reason survives rendering on the cataloged arm", () => {
    for (const arm of catalogedArms()) {
      const rendered = renderCatalog(arm, defaultShadowLimits);

      for (const reason of unresolvedReasons) {
        expect(rendered[`shadow.unresolved.${reason}.total`]).toBe(1);
      }
    }
  });
});
