import { describe, expect, test } from "vitest";
import type { Provenance } from "@keeper.sh/sync-protocol";
import { cataloged, runShadow } from "../support/scenario";
import {
  destinationSnapshot,
  foreignInstallation,
  mirrorRow,
  ourInstallation,
  ownMirrorEvent,
  shadowOptions,
  slotIdentity,
  storedSourceEvent,
  syncInput,
} from "../support/fixtures";

const echoed = slotIdentity("evt-echo", "2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z");
const foreignMirror = slotIdentity(
  "evt-foreign-mirror",
  "2026-03-11T09:00:00.000Z",
  "2026-03-11T10:00:00.000Z",
);

const driftedSourceRow = (provenance: Provenance) =>
  storedSourceEvent({
    identity: echoed,
    provenance,
    revision: 7,
    fingerprint: "fp-changed-by-the-provider",
    content: { title: "rewritten by the provider" },
  });

const sourceRowStampedBy = (provenance: Provenance) =>
  syncInput({
    storedSourceEvents: [driftedSourceRow(provenance)],
    mirrors: [
      mirrorRow({
        identity: echoed,
        destinationId: "mirror-evt-echo",
        destinationHandle: "handle-evt-echo",
      }),
    ],
    destinationListing: destinationSnapshot({
      events: [
        ownMirrorEvent({
          id: "mirror-evt-echo",
          uid: "evt-echo",
          deleteHandle: "handle-evt-echo",
        }),
      ],
    }),
  });

const anotherInstallationsMirror = () =>
  syncInput({
    storedSourceEvents: [],
    mirrors: [],
    destinationListing: destinationSnapshot({
      events: [
        ownMirrorEvent(
          {
            id: "mirror-someone-else",
            uid: foreignMirror.uid.value,
            deleteHandle: "handle-someone-else",
          },
          foreignInstallation,
        ),
      ],
    }),
  });

describe("provenance decides what may be written and what may be removed", () => {
  test("SHADOW-O15: an event carrying our own provenance is not echoed back as a write", () => {
    const catalog = cataloged(
      runShadow(
        sourceRowStampedBy({ kind: "ours", installation: ourInstallation }),
        shadowOptions(),
      ),
    );

    expect(catalog.updates).toEqual([]);
    expect(catalog.creations).toEqual([]);
    expect(catalog.replacements).toEqual([]);
  });

  test("SHADOW-O15: the same drift from a foreign row is a write, so the guard is what suppressed it", () => {
    const catalog = cataloged(
      runShadow(sourceRowStampedBy({ kind: "foreign" }), shadowOptions()),
    );

    expect(catalog.updates.map((entry) => entry.identityKey).length).toBe(1);
  });

  test("SHADOW-O15: an indeterminate source row is reported rather than written or laundered", () => {
    const catalog = cataloged(
      runShadow(sourceRowStampedBy({ kind: "indeterminate" }), shadowOptions()),
    );

    expect(catalog.updates).toEqual([]);
    expect(catalog.unresolved.map((entry) => entry.reason)).toContain("provenanceIndeterminate");
  });

  test("SHADOW-O16: another installation's mirror is not catalogued as an orphan deletion", () => {
    const catalog = cataloged(runShadow(anotherInstallationsMirror(), shadowOptions()));

    expect(catalog.deletions).toEqual([]);
  });

  test("SHADOW-O16: the foreign mirror is not silently ignored either", () => {
    const catalog = cataloged(runShadow(anotherInstallationsMirror(), shadowOptions()));
    const serialised = JSON.stringify(catalog);

    expect(serialised).toContain("mirror-someone-else");
  });
});
