import { describe, expect, test } from "vitest";
import { translateDestinationSync } from "../../src/index";
import { firstOf } from "../support/scenario";
import {
  destinationPartial,
  destinationSnapshot,
  mirrorRow,
  mirrorWindow,
  otherCalendar,
  ownMirrorEvent,
  shadowOptions,
  slotIdentity,
  storedSourceEvent,
  syncInput,
} from "../support/fixtures";

const identity = slotIdentity("evt-one", "2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z");

describe("the destination listing is the caller's", () => {
  test("SHADOW-I32: the destination listing is forwarded unchanged", () => {
    const listing = destinationSnapshot({
      events: [ownMirrorEvent({ id: "mirror-evt-one", uid: "evt-one" })],
    });
    const translation = translateDestinationSync(
      syncInput({
        storedSourceEvents: [storedSourceEvent({ identity })],
        mirrors: [mirrorRow({ identity })],
        destinationListing: listing,
      }),
      shadowOptions(),
    );
    if (translation.kind !== "translated") {
      throw new Error(`expected a translation, got ${translation.reason}`);
    }
    const { observed } = firstOf(translation.units);
    if (observed.kind !== "bothSides") {
      throw new Error("expected both sides to be observed");
    }

    expect(observed.destination).toBe(listing);
  });

  test("SHADOW-I32: a partial destination listing is forwarded as partial, not upgraded", () => {
    const listing = destinationPartial({});
    const translation = translateDestinationSync(
      syncInput({
        storedSourceEvents: [storedSourceEvent({ identity })],
        mirrors: [mirrorRow({ identity })],
        destinationListing: listing,
      }),
      shadowOptions(),
    );
    if (translation.kind !== "translated") {
      throw new Error(`expected a translation, got ${translation.reason}`);
    }
    const { observed } = firstOf(translation.units);
    if (observed.kind !== "bothSides") {
      throw new Error("expected both sides to be observed");
    }

    expect(observed.destination.kind).toBe("partial");
  });

  test("SHADOW-I32: a listing of another calendar refuses the translation", () => {
    const translation = translateDestinationSync(
      syncInput({
        storedSourceEvents: [storedSourceEvent({ identity })],
        mirrors: [mirrorRow({ identity })],
        destinationListing: destinationSnapshot({
          scope: { calendar: otherCalendar, window: mirrorWindow, expandRecurrences: false },
        }),
      }),
      shadowOptions(),
    );

    expect(translation.kind).toBe("refused");
    if (translation.kind !== "refused") {
      throw new Error("expected a refusal");
    }
    expect(translation.reason).toBe("destinationListingIsNotThisDestination");
  });

  test("SHADOW-I32: a mirror pointing at another destination refuses the translation", () => {
    const translation = translateDestinationSync(
      syncInput({
        storedSourceEvents: [storedSourceEvent({ identity })],
        mirrors: [mirrorRow({ identity, destinationCalendar: otherCalendar })],
      }),
      shadowOptions(),
    );

    expect(translation.kind).toBe("refused");
    if (translation.kind !== "refused") {
      throw new Error("expected a refusal");
    }
    expect(translation.reason).toBe("mirrorPointsAtAnotherDestination");
  });
});
