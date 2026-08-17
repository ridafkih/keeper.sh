import { describe, expect, test } from "vitest";
import { listingOf } from "../support/expect";
import { createHarness, marchWindow, operationContext, scopeOver } from "../support/harness";
import { ourItem, seedOf } from "../support/items";

describe("our own writes are recognised by a durable marker, not by a UID convention", () => {
  test("MS-O31: only the stamped extended property claims our installation; the category is indeterminate and the iCalUId proves nothing", async () => {
    const harness = createHarness();
    harness.fake.seedFromProvider(seedOf([]));
    harness.fake.putItems([
      ourItem("id-property", "microsoft-tests", "property"),
      ourItem("id-category", "microsoft-tests", "category"),
      ourItem("id-uid-shaped", "microsoft-tests", "uid"),
    ]);

    const listing = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(marchWindow), resume: null },
        operationContext(harness.environment),
      ),
    );

    const provenanceById = new Map(
      (listing.events ?? []).map((event) => [event.id.value, event.provenance.kind]),
    );
    expect(provenanceById.get("id-property")).toBe("ours");
    expect(provenanceById.get("id-category")).toBe("indeterminate");
    expect(provenanceById.get("id-uid-shaped")).toBe("foreign");
  });

  test("MS-O31: another installation's stamp is read as its own, never as ours", async () => {
    const harness = createHarness();
    harness.fake.seedFromProvider(seedOf([]));
    harness.fake.putItems([ourItem("id-elsewhere", "another-installation", "property")]);

    const listing = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(marchWindow), resume: null },
        operationContext(harness.environment),
      ),
    );

    const found = (listing.events ?? []).find((event) => event.id.value === "id-elsewhere");
    expect(found?.provenance).toEqual({
      kind: "ours",
      installation: { kind: "installationId", value: "another-installation" },
    });
    expect(listing.diagnostics.selfAuthored.total).toBe(0);
  });

  test("MS-O31: self-authored events are counted apart from withheld ones", async () => {
    const harness = createHarness();
    harness.fake.seedFromProvider(seedOf([]));
    harness.fake.putItems([ourItem("id-property", "microsoft-tests", "property")]);

    const listing = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(marchWindow), resume: null },
        operationContext(harness.environment),
      ),
    );

    expect(listing.diagnostics.selfAuthored.total).toBe(1);
    expect(listing.diagnostics.withheld.total).toBe(0);
  });
});
