import { describe, expect, test } from "vitest";
import { readEventType, verdictForEventType } from "../../src/decode/event-type";
import { listingOf } from "../support/expect";
import { createHarness, marchWindow, operationContext, scopeOver } from "../support/harness";
import { timedItem } from "../support/items";

const workingLocationAndOutOfOffice = () => [
  timedItem({
    id: "working-location",
    start: "2026-03-19T09:00:00.000Z",
    end: "2026-03-19T17:00:00.000Z",
    eventType: "workingLocation",
  }),
  timedItem({
    id: "out-of-office",
    start: "2026-03-20T09:00:00.000Z",
    end: "2026-03-20T17:00:00.000Z",
    eventType: "outOfOffice",
  }),
];

describe("Google's event types are mapped exhaustively, never defaulted", () => {
  test("GOOG-O27: a workingLocation event is withheld, an outOfOffice event is free", async () => {
    const harness = createHarness();
    harness.fake.putItems(workingLocationAndOutOfOffice());

    const listing = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(marchWindow), resume: null },
        operationContext(harness.environment),
      ),
    );

    expect((listing.events ?? []).map((event) => event.id.value)).toEqual(["out-of-office"]);
    expect(listing.withheld?.at(0)?.id?.value).toBe("working-location");
  });

  test("GOOG-O27: an event type Google has not published is unrecognised, never busy", () => {
    expect(readEventType("someNewTypeGoogleAdded")).toBeNull();
  });

  test("GOOG-O27: a default event is mirrored as busy", () => {
    expect(verdictForEventType("default")).toEqual({ kind: "mirrored", availability: "busy" });
  });
});
