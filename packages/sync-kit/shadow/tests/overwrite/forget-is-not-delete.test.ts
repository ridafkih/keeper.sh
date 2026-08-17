import { describe, expect, test } from "vitest";
import { defaultShadowLimits, renderCatalog } from "../../src/index";
import { catalogOfPlan, cataloged, firstOf } from "../support/scenario";
import { forgetTombstone, planWith, retireTombstone } from "../support/plans";
import { slotIdentity } from "../support/fixtures";

const retired = slotIdentity("evt-retired", "2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z");
const forgotten = slotIdentity(
  "evt-forgotten",
  "2026-03-11T09:00:00.000Z",
  "2026-03-11T10:00:00.000Z",
);

const oneOfEach = () =>
  cataloged(
    catalogOfPlan(
      [retired, forgotten],
      planWith({
        tombstones: [
          retireTombstone(retired, "absentFromSnapshot"),
          forgetTombstone(forgotten, "outsideMirrorWindow"),
        ],
      }),
    ),
  );

describe("forgetting a row is not deleting an event", () => {
  test("SHADOW-O14: the two tombstone kinds land in different fields", () => {
    const catalog = oneOfEach();

    expect(catalog.deletions.map((entry) => entry.uid.value)).toEqual(["evt-retired"]);
    expect(catalog.forgottenLocalRows.map((entry) => entry.uid.value)).toEqual(["evt-forgotten"]);
  });

  test("SHADOW-O14: deletions holds only the handle-carrying tombstone", () => {
    const catalog = oneOfEach();

    expect(catalog.deletions.length).toBe(1);
    expect(firstOf(catalog.deletions).deleteHandle.value).toBe("handle-evt-retired");
  });

  test("SHADOW-O14: local cleanup is counted separately and never as destruction", () => {
    const rendered = renderCatalog(oneOfEach(), defaultShadowLimits);

    expect(rendered["shadow.deletions.total"]).toBe(1);
    expect(rendered["shadow.forgotten_rows.total"]).toBe(1);
  });

  test("SHADOW-O14: a forgotten row keeps its cause so it can be told apart from a retirement", () => {
    const catalog = oneOfEach();

    expect(firstOf(catalog.forgottenLocalRows).cause).toBe("outsideMirrorWindow");
    expect(firstOf(catalog.deletions).cause).toBe("absentFromSnapshot");
  });
});
