import type { RemoteEvent } from "@keeper.sh/sync-protocol";
import { describe, expect, test } from "vitest";
import { derivableRemovals } from "../src/assertions/no-removal";
import { listChanges, okValue, write } from "./support/drive";
import { referenceHarness, runReferenceCase } from "./support/harness";
import {
  createIntent,
  foreignEvent,
  installation,
  occurrence,
  scopeOver,
  spanning,
  summarise,
  timedAt,
  knownFrom,
  seedOf,
} from "./support/protocol";

const march = spanning("2026-03-01T00:00:00.000Z", "2026-04-01T00:00:00.000Z");
const scope = scopeOver(march);

const canary = foreignEvent({
  uid: "canary",
  title: "Someone else's event",
  start: "2026-03-06T09:00:00.000Z",
  end: "2026-03-06T10:00:00.000Z",
});

const mirrored = occurrence(
  "Mirrored meeting",
  timedAt("2026-03-07T09:00:00.000Z", "2026-03-07T10:00:00.000Z"),
);

const provenanceKindsOf = (events: readonly RemoteEvent[]): string[] =>
  events.map((event) => event.provenance.kind);

const installationOf = (event: RemoteEvent): string => {
  if (event.provenance.kind === "ours") {
    return event.provenance.installation.value;
  }
  return `not-ours:${event.provenance.kind}`;
};

describe("we never echo our own writes and never touch a stranger's event", () => {
  test("CONF-O16: an event we wrote comes back as ours with our installation id", async () => {
    const harness = await referenceHarness();
    await write(harness.provider, harness.environment, createIntent("mirrored", mirrored));

    const listing = okValue(await listChanges(harness.provider, harness.environment, scope));
    const ours = (listing.events ?? []).filter((event) => event.provenance.kind === "ours");

    expect(ours).toHaveLength(1);
    expect(ours.map((event) => installationOf(event))).toEqual([installation.value]);
    await harness.dispose();
  });

  test("CONF-O16: the round trip goes through the adapter, not through our own record of the write", async () => {
    const harness = await referenceHarness();
    const created = okValue(
      await write(harness.provider, harness.environment, createIntent("mirrored", mirrored)),
    );

    const listing = okValue(await listChanges(harness.provider, harness.environment, scope));

    expect(created.kind).toBe("created");
    expect(provenanceKindsOf(listing.events ?? [])).toEqual(["ours"]);
    await harness.dispose();
  });

  test("CONF-O17: a foreign canary survives every reconciliation the suite generates", async () => {
    const harness = await referenceHarness();
    await harness.provider.seed(seedOf([canary], []));
    const before = await harness.provider.inspect();

    await write(harness.provider, harness.environment, createIntent("mirrored", mirrored));
    await listChanges(harness.provider, harness.environment, scope);
    const after = await harness.provider.inspect();

    const survivorsBefore = before.objects.filter((event) => event.uid.value === "canary");
    const survivorsAfter = after.objects.filter((event) => event.uid.value === "canary");

    expect(summarise(survivorsAfter)).toEqual(summarise(survivorsBefore));
    expect(survivorsAfter).toHaveLength(1);
    await harness.dispose();
  });

  test("CONF-O17: no removal is ever derivable for a foreign event", async () => {
    const harness = await referenceHarness();
    await harness.provider.seed(seedOf([canary], []));

    const listing = okValue(await listChanges(harness.provider, harness.environment, scope));
    const removable = derivableRemovals({
      listing,
      known: knownFrom([canary]),
      withinWindow: () => true,
    });

    expect(removable).toEqual([]);
    await harness.dispose();
  });

  test("CONF-O16: the generated case passes for the reference provider", async () => {
    await expect(runReferenceCase("CONF-O16")).resolves.toBeUndefined();
  });

  test("CONF-O17: the generated case passes for the reference provider", async () => {
    await expect(runReferenceCase("CONF-O17")).resolves.toBeUndefined();
  });
});
