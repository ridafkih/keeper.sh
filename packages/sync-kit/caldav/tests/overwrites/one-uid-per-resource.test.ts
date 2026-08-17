import type { ChangeListing } from "@keeper.sh/sync-protocol";
import { describe, expect, test } from "vitest";
import { listingOf } from "../support/expect";
import { calendarPath } from "../support/fake-caldav";
import { createHarness, decadeWindow, operationContext, scopeOver } from "../support/harness";
import { calendarOf } from "../support/resources";

const uidsOf = (listing: ChangeListing): readonly string[] =>
  (listing.events ?? []).map((event) => event.uid.value);

const twoUids = (order: "forward" | "reverse"): string => {
  const alpha = { uid: "alpha@example.com", summary: "Alpha", sequence: 1 };
  const beta = { uid: "beta@example.com", summary: "Beta", sequence: 2 };
  if (order === "forward") {
    return calendarOf([alpha, beta]);
  }
  return calendarOf([beta, alpha]);
};

describe("a publisher that put two UIDs in one resource cannot cause churn", () => {
  test("DAV-O45: two UIDs in one resource collapse to the same winner under either ordering", async () => {
    const forward = createHarness({
      resources: [{ path: `${calendarPath}mixed.ics`, data: twoUids("forward") }],
    });
    const reverse = createHarness({
      resources: [{ path: `${calendarPath}mixed.ics`, data: twoUids("reverse") }],
    });
    const scope = scopeOver(decadeWindow);

    const forwardListing = listingOf(
      await forward.provider.listChanges(
        { scope, resume: null },
        operationContext(forward.environment, { deadlineMs: 2000 }),
      ),
    );
    const reverseListing = listingOf(
      await reverse.provider.listChanges(
        { scope, resume: null },
        operationContext(reverse.environment, { deadlineMs: 2000 }),
      ),
    );

    expect(uidsOf(forwardListing).length).toBe(1);
    expect(uidsOf(forwardListing)).toEqual(uidsOf(reverseListing));
  }, 30_000);

  test("DAV-O45: the losing UID is withheld rather than dropped without a counter", async () => {
    const harness = createHarness({
      resources: [{ path: `${calendarPath}mixed.ics`, data: twoUids("forward") }],
    });

    const listing = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(decadeWindow), resume: null },
        operationContext(harness.environment, { deadlineMs: 2000 }),
      ),
    );

    expect((listing.withheld ?? []).length).toBe(1);
    expect(listing.diagnostics.withheld.total).toBe(1);
  }, 30_000);

  test("DAV-O45: two resources claiming one UID collapse to one event under either enumeration order", async () => {
    const older = { uid: "shared@example.com", summary: "Older", sequence: 1 };
    const newer = { uid: "shared@example.com", summary: "Newer", sequence: 4 };
    const listings: ChangeListing[] = [];
    for (const names of [
      ["a-first.ics", "z-second.ics"],
      ["z-second.ics", "a-first.ics"],
    ]) {
      const [olderName = "", newerName = ""] = names;
      const harness = createHarness({
        resources: [
          { path: `${calendarPath}${olderName}`, data: calendarOf([older]) },
          { path: `${calendarPath}${newerName}`, data: calendarOf([newer]) },
        ],
      });
      listings.push(
        listingOf(
          await harness.provider.listChanges(
            { scope: scopeOver(decadeWindow), resume: null },
            operationContext(harness.environment, { deadlineMs: 2000 }),
          ),
        ),
      );
    }
    expect(listings.map((listing) => uidsOf(listing))).toEqual([
      ["shared@example.com"],
      ["shared@example.com"],
    ]);
    expect(
      listings.map((listing) => (listing.events ?? []).map((event) => event.content.title)),
    ).toEqual([["Newer"], ["Newer"]]);
  }, 30_000);
});
