import { describe, expect, test } from "vitest";
import { defaultShadowLimits, renderCatalog } from "../../src/index";
import { cataloged, firstOf, runShadow } from "../support/scenario";
import { planWith, retireTombstone } from "../support/plans";
import {
  destinationSnapshot,
  mirrorRow,
  ownMirrorEvent,
  shadowOptions,
  slotIdentity,
  storedSourceEvent,
  syncInput,
} from "../support/fixtures";

const identity = slotIdentity("evt-one", "2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z");

const stubPlan = () => planWith({ tombstones: [retireTombstone(identity, "absentFromSnapshot")] });

const staleStoredHandle = () =>
  syncInput({
    storedSourceEvents: [storedSourceEvent({ identity })],
    mirrors: [
      mirrorRow({
        identity,
        destinationId: "mirror-evt-one",
        destinationHandle: "https://dav.example/legacy/evt-one.ics",
      }),
    ],
    destinationListing: destinationSnapshot({
      events: [
        ownMirrorEvent({
          id: "mirror-evt-one",
          uid: "evt-one",
          deleteHandle: "handle-evt-one",
        }),
      ],
    }),
  });

const noObservedMirror = () =>
  syncInput({
    storedSourceEvents: [storedSourceEvent({ identity })],
    mirrors: [
      mirrorRow({
        identity,
        destinationId: "mirror-evt-one",
        destinationHandle: "https://dav.example/legacy/evt-one.ics",
      }),
    ],
    destinationListing: destinationSnapshot({ events: [] }),
  });

describe("the catalog shows the handle the plan would actually send", () => {
  test("SHADOW-O18: a stored handle that differs from the observed one is not what is shown", () => {
    const entry = firstOf(
      cataloged(runShadow(staleStoredHandle(), shadowOptions({ plan: stubPlan }))).deletions,
    );

    expect(entry.deleteHandle.value).toBe("handle-evt-one");
    expect(entry.handleSource).toBe("observedListing");
    expect(entry.deleteHandle.value).not.toBe("https://dav.example/legacy/evt-one.ics");
  });

  test("SHADOW-O18: uid, remote id and delete handle are three distinct fields", () => {
    const entry = firstOf(
      cataloged(runShadow(staleStoredHandle(), shadowOptions({ plan: stubPlan }))).deletions,
    );

    expect(entry.uid.value).toBe("evt-one");
    expect(entry.remoteEventId.value).toBe("mirror-evt-one");
    expect(
      new Set([entry.uid.value, entry.remoteEventId.value, entry.deleteHandle.value]).size,
    ).toBe(3);
  });

  test("SHADOW-O18: a fallback to the stored handle is labelled and counted", () => {
    const catalog = cataloged(runShadow(noObservedMirror(), shadowOptions({ plan: stubPlan })));
    const entry = firstOf(catalog.deletions);
    const rendered = renderCatalog(catalog, defaultShadowLimits);

    expect(entry.handleSource).toBe("storedMapping");
    expect(entry.deleteHandle.value).toBe("https://dav.example/legacy/evt-one.ics");
    expect(rendered["shadow.deletions.handle_fallback_count"]).toBe(1);
  });
});
