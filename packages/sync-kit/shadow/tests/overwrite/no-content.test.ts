import { describe, expect, test } from "vitest";
import { defaultShadowLimits, renderCatalog } from "../../src/index";
import { cataloged, runShadow } from "../support/scenario";
import { createWrite, planWith, replaceWrite, retireTombstone, updateWrite } from "../support/plans";
import {
  destinationSnapshot,
  mirrorRow,
  ownMirrorEvent,
  shadowOptions,
  slotIdentity,
  storedSourceEvent,
  syncInput,
} from "../support/fixtures";

const markers = {
  title: "MARKER-TITLE-1a2b",
  description: "MARKER-DESCRIPTION-3c4d",
  location: "MARKER-LOCATION-5e6f",
};

const keys = ["evt-create", "evt-update", "evt-replace", "evt-retire"];
const identities = keys.map((key) =>
  slotIdentity(key, "2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z"),
);

const identityAt = (index: number) => {
  const found = identities.at(index);
  if (!found) {
    throw new Error(`no identity at ${index}`);
  }
  return found;
};

const contentBearingPlan = () =>
  planWith({
    writes: [
      createWrite(identityAt(0), markers),
      updateWrite(identityAt(1), markers),
      replaceWrite(identityAt(2), markers),
    ],
    tombstones: [retireTombstone(identityAt(3), "absentFromSnapshot")],
  });

const contentBearingInput = () =>
  syncInput({
    storedSourceEvents: identities.map((identity) =>
      storedSourceEvent({ identity, content: markers }),
    ),
    mirrors: identities.map((identity) =>
      mirrorRow({
        identity,
        destinationId: `mirror-${identity.uid.value}`,
        destinationHandle: `handle-${identity.uid.value}`,
      }),
    ),
    destinationListing: destinationSnapshot({
      events: identities.map((identity) =>
        ownMirrorEvent({
          id: `mirror-${identity.uid.value}`,
          uid: identity.uid.value,
          deleteHandle: `handle-${identity.uid.value}`,
          title: markers.title,
          description: markers.description,
          location: markers.location,
        }),
      ),
    }),
  });

const contentBearingCatalog = () =>
  cataloged(runShadow(contentBearingInput(), shadowOptions({ plan: () => contentBearingPlan() })));

describe("no content reaches a log", () => {
  test("SHADOW-O21: no marker string appears in the structured catalog", () => {
    const serialised = JSON.stringify(contentBearingCatalog());

    for (const marker of Object.values(markers)) {
      expect(serialised).not.toContain(marker);
    }
  });

  test("SHADOW-O21: no marker string appears in the rendered catalog", () => {
    const rendered = JSON.stringify(renderCatalog(contentBearingCatalog(), defaultShadowLimits));

    for (const marker of Object.values(markers)) {
      expect(rendered).not.toContain(marker);
    }
  });

  test("SHADOW-O21: the catalog is not empty, so the absence means something", () => {
    const catalog = contentBearingCatalog();

    expect(catalog.deletions.length).toBeGreaterThan(0);
    expect(catalog.creations.length + catalog.updates.length + catalog.replacements.length).toBeGreaterThan(
      0,
    );
  });
});
