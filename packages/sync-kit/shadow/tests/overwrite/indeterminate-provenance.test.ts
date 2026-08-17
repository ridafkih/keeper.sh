import { describe, expect, test } from "vitest";
import { defaultShadowLimits, renderCatalog } from "../../src/index";
import { cataloged, runShadow } from "../support/scenario";
import {
  destinationSnapshot,
  indeterminateMirrorEvent,
  shadowOptions,
  syncInput,
} from "../support/fixtures";

const unattributable = () =>
  syncInput({
    storedSourceEvents: [],
    mirrors: [],
    destinationListing: destinationSnapshot({
      events: [
        indeterminateMirrorEvent({
          id: "mirror-unknown-origin",
          uid: "evt-unknown-origin",
          deleteHandle: "handle-unknown-origin",
        }),
      ],
    }),
  });

describe("an unattributable destination event", () => {
  test("SHADOW-O17: an indeterminate destination event is never catalogued as a deletion", () => {
    const catalog = cataloged(runShadow(unattributable(), shadowOptions()));

    expect(catalog.deletions).toEqual([]);
  });

  test("SHADOW-O17: it appears as provenanceIndeterminate with its own scalar counter", () => {
    const catalog = cataloged(runShadow(unattributable(), shadowOptions()));
    const rendered = renderCatalog(catalog, defaultShadowLimits);
    const reported = catalog.unresolved.filter(
      (entry) => entry.reason === "provenanceIndeterminate",
    );

    expect(reported.length).toBe(1);
    expect(rendered["shadow.unresolved.provenanceIndeterminate.total"]).toBe(1);
  });

  test("SHADOW-O17: it is not folded into a residual bucket", () => {
    const rendered = renderCatalog(
      cataloged(runShadow(unattributable(), shadowOptions())),
      defaultShadowLimits,
    );

    expect(Object.hasOwn(rendered, "shadow.unresolved.other.total")).toBe(false);
  });

  test("SHADOW-O17: the reported entry names the remote id a reviewer would look up", () => {
    const catalog = cataloged(runShadow(unattributable(), shadowOptions()));
    const reported = catalog.unresolved.filter(
      (entry) => entry.reason === "provenanceIndeterminate",
    );

    expect(reported.map((entry) => entry.id?.value)).toEqual(["mirror-unknown-origin"]);
  });
});
