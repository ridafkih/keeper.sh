import { describe, expect, test } from "vitest";
import { sourceIdentityKey } from "@keeper.sh/sync-reconcile";
import { catalogOfPlan, cataloged, firstOf, runShadow } from "../support/scenario";
import { planWith, retireTombstone } from "../support/plans";
import {
  destinationSnapshot,
  mirrorRow,
  ownMirrorEvent,
  overrideIdentity,
  shadowOptions,
  slotIdentity,
  sourceCalendarA,
  storedSourceEvent,
  syncInput,
} from "../support/fixtures";

const slot = slotIdentity("evt-slot", "2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z");
const occurrence = overrideIdentity("evt-series", "2026-03-11T09:00:00.000Z");

describe("a deletion entry locates the real calendar event", () => {
  test("SHADOW-I15: a deletion entry names the uid, the remote id and the delete handle separately", () => {
    const catalog = cataloged(
      catalogOfPlan([slot], planWith({ tombstones: [retireTombstone(slot, "absentFromSnapshot")] })),
    );
    const entry = firstOf(catalog.deletions);

    expect(entry.uid.value).toBe("evt-slot");
    expect(entry.remoteEventId.value).toBe("mirror-evt-slot");
    expect(entry.deleteHandle.value).toBe("handle-evt-slot");
    expect(entry.identityKey).toBe(sourceIdentityKey(slot));
    expect(entry.sourceCalendar).toEqual(sourceCalendarA);
    expect(entry.time).toBeDefined();
  });

  test("SHADOW-I15: an occurrence deletion names the recurrence instant it sits on", () => {
    const catalog = cataloged(
      catalogOfPlan(
        [occurrence],
        planWith({ tombstones: [retireTombstone(occurrence, "absentFromSnapshot")] }),
      ),
    );
    const entry = firstOf(catalog.deletions);

    expect(entry.recurrence).toEqual({
      kind: "override",
      recurrenceInstant: { kind: "instant", value: "2026-03-11T09:00:00.000Z" },
    });
  });

  test("SHADOW-I15: a slot deletion names both slot bounds", () => {
    const catalog = cataloged(
      catalogOfPlan([slot], planWith({ tombstones: [retireTombstone(slot, "absentFromSnapshot")] })),
    );

    expect(firstOf(catalog.deletions).recurrence).toEqual({
      kind: "slot",
      start: { kind: "instant", value: "2026-03-10T09:00:00.000Z" },
      end: { kind: "instant", value: "2026-03-10T10:00:00.000Z" },
    });
  });

  test("SHADOW-I16: a mapping whose delete handle differs from its uid renders all three", () => {
    const catalog = cataloged(
      runShadow(
        syncInput({
          storedSourceEvents: [storedSourceEvent({ identity: slot })],
          mirrors: [
            mirrorRow({
              identity: slot,
              destinationId: "graph-AAMkAD",
              destinationHandle: "https://dav.example/cal/9f2c.ics",
            }),
          ],
          destinationListing: destinationSnapshot({
            events: [
              ownMirrorEvent({
                id: "graph-AAMkAD",
                uid: "evt-slot",
                deleteHandle: "https://dav.example/cal/9f2c.ics",
              }),
            ],
          }),
        }),
        shadowOptions({
          plan: () => planWith({ tombstones: [retireTombstone(slot, "absentFromSnapshot")] }),
        }),
      ),
    );
    const entry = firstOf(catalog.deletions);

    expect(entry.uid.value).toBe("evt-slot");
    expect(entry.remoteEventId.value).toBe("graph-AAMkAD");
    expect(entry.deleteHandle.value).toBe("https://dav.example/cal/9f2c.ics");
    expect(new Set([entry.uid.value, entry.remoteEventId.value, entry.deleteHandle.value]).size).toBe(3);
  });
});
