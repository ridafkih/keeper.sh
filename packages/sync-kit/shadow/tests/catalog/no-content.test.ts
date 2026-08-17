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
  title: "MARKER-TITLE-9f2c",
  description: "MARKER-DESCRIPTION-4b81",
  location: "MARKER-LOCATION-77ae",
};

const identities = ["evt-a", "evt-b", "evt-c", "evt-d"].map((key) =>
  slotIdentity(key, "2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z"),
);

const identityAt = (index: number) => {
  const found = identities.at(index);
  if (!found) {
    throw new Error(`no identity at ${index}`);
  }
  return found;
};

const markedPlan = () =>
  planWith({
    writes: [
      createWrite(identityAt(0), markers),
      updateWrite(identityAt(1), markers),
      replaceWrite(identityAt(2), markers),
    ],
    tombstones: [retireTombstone(identityAt(3), "absentFromSnapshot")],
  });

const markedInput = () =>
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

const markedCatalog = () =>
  cataloged(runShadow(markedInput(), shadowOptions({ plan: () => markedPlan() })));

describe("customer content never reaches the catalog", () => {
  test("SHADOW-I15: no catalog field carries a title, description or location", () => {
    const serialised = JSON.stringify(markedCatalog());

    expect(serialised).not.toContain(markers.title);
    expect(serialised).not.toContain(markers.description);
    expect(serialised).not.toContain(markers.location);
  });

  test("SHADOW-I15: a rendered catalog of a content-bearing plan contains none of its content", () => {
    const rendered = JSON.stringify(renderCatalog(markedCatalog(), defaultShadowLimits));

    expect(rendered).not.toContain(markers.title);
    expect(rendered).not.toContain(markers.description);
    expect(rendered).not.toContain(markers.location);
  });

  test("SHADOW-I15: the catalog still names every identity it acted on", () => {
    const serialised = JSON.stringify(markedCatalog());

    for (const identity of identities) {
      expect(serialised).toContain(identity.uid.value);
    }
  });

  test("SHADOW-I15: not even the content fingerprint value appears", () => {
    const serialised = JSON.stringify(markedCatalog());

    expect(serialised).not.toContain("fp-evt-a");
    expect(serialised).not.toContain("mirror-fingerprint");
  });
});
