import { describe, expect, test } from "vitest";
import { decodeProvenance, provenancePropertyKey } from "../../src/decode/provenance";
import { deterministicEventId } from "../../src/write/event-id";
import { listingOf, outcomeOf } from "../support/expect";
import {
  createHarness,
  googleCalendar,
  marchWindow,
  operationContext,
  scopeOver,
} from "../support/harness";
import { createIntent, normalizedOf, timedContent } from "../support/intents";
import { cancelledException } from "../support/items";

const ourDeterministicId = (harness: ReturnType<typeof createHarness>): string => {
  const derived = deterministicEventId(
    { kind: "idempotencyKey", value: "mirror-of-source-1" },
    googleCalendar.calendar,
    harness.environment.hash,
  );
  if (derived.kind !== "eventId") {
    throw new Error("the deterministic id fell outside Google's length rule");
  }
  return derived.value;
};

describe("our own writes are recognised even as bare tombstones", () => {
  test("GOOG-O16: a cancelled exception carrying only an id is still recognised as ours", () => {
    const harness = createHarness();
    const ours = ourDeterministicId(harness);
    const tombstone = cancelledException(ours, "master", "2026-03-21T09:00:00.000Z");

    const provenance = decodeProvenance(tombstone, {
      installation: harness.environment.installation,
      deterministicIds: new Set([ours]),
    });

    expect(provenance).toEqual({
      kind: "ours",
      installation: harness.environment.installation,
    });
  });

  test("GOOG-O16: the extended property channel recognises a full event", () => {
    const harness = createHarness();

    const provenance = decodeProvenance(
      {
        id: "some-id",
        status: "confirmed",
        extendedProperties: {
          private: { [provenancePropertyKey]: harness.environment.installation.value },
        },
      },
      { installation: harness.environment.installation, deterministicIds: new Set() },
    );

    expect(provenance.kind).toBe("ours");
  });

  test("GOOG-O16: an event we wrote lists back as ours through the adapter, not only in the decoder", async () => {
    const harness = createHarness();
    const created = outcomeOf(
      await harness.provider.write(
        createIntent(
          "mirror-of-source-1",
          normalizedOf(timedContent({ start: "2026-03-21T09:00:00.000Z", end: "2026-03-21T10:00:00.000Z" })),
          harness.environment.installation.value,
        ),
        operationContext(harness.environment),
      ),
    );
    if (created.kind !== "created") {
      throw new Error(`the create answered "${created.kind}"`);
    }
    harness.fake.stripInstallationStamp(created.remote.id.value);

    const listed = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(marchWindow), resume: null },
        operationContext(harness.environment),
      ),
    );

    const mine = (listed.events ?? []).find(
      (event) => event.id.value === created.remote.id.value,
    );
    expect(mine?.provenance.kind).toBe("ours");
    expect(listed.diagnostics.selfAuthored.total).toBeGreaterThan(0);
  });

  test("GOOG-O16: our own tombstone is counted as self-authored, never handed back as a removal", async () => {
    const harness = createHarness();
    const created = outcomeOf(
      await harness.provider.write(
        createIntent(
          "mirror-of-source-1",
          normalizedOf(timedContent({ start: "2026-03-21T09:00:00.000Z", end: "2026-03-21T10:00:00.000Z" })),
          harness.environment.installation.value,
        ),
        operationContext(harness.environment),
      ),
    );
    if (created.kind !== "created") {
      throw new Error(`the create answered "${created.kind}"`);
    }
    harness.fake.stripInstallationStamp(created.remote.id.value);
    harness.fake.cancelItem(created.remote.id.value);

    const listed = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(marchWindow), resume: null },
        operationContext(harness.environment),
      ),
    );

    expect(listed.removals ?? []).toEqual([]);
    expect(listed.diagnostics.selfAuthored.total).toBe(1);
  });

  test("GOOG-O16: a tombstone that can carry no stamp at all is indeterminate, never asserted foreign", () => {
    const harness = createHarness();

    const provenance = decodeProvenance(cancelledException("someone-elses", "master", "2026-03-21T09:00:00.000Z"), {
      installation: harness.environment.installation,
      deterministicIds: new Set(),
    });

    expect(provenance).toEqual({ kind: "indeterminate" });
  });

  test("GOOG-O16: an event neither channel claims is foreign, never indeterminate by default", () => {
    const harness = createHarness();

    const provenance = decodeProvenance(
      { id: "somebody-elses", status: "confirmed" },
      { installation: harness.environment.installation, deterministicIds: new Set() },
    );

    expect(provenance).toEqual({ kind: "foreign" });
  });
});
