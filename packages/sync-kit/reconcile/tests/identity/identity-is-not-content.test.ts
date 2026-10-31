import type { RemoteEvent } from "@keeper.sh/sync-protocol";
import { describe, expect, test } from "vitest";
import { firstOf } from "../support/at";
import { planReconciliation } from "../../src/index";
import {
  foreignEvent,
  knownEvent,
  knownState,
  mapping,
  mappingSet,
  policy,
  slotIdentity,
  snapshotListing,
  sourceOnly,
} from "../support/fixtures";

const span = { start: "2026-03-10T09:00:00.000Z", end: "2026-03-10T10:00:00.000Z" };
const identity = slotIdentity("evt-1", span.start, span.end);

const contentEdits: readonly (readonly [string, (event: RemoteEvent) => RemoteEvent])[] = [
  ["title", (event) => ({ ...event, content: { ...event.content, title: "renamed" } })],
  ["description", (event) => ({ ...event, content: { ...event.content, description: "a new body" } })],
  ["location", (event) => ({ ...event, content: { ...event.content, location: "room 2" } })],
  ["availability", (event) => ({ ...event, content: { ...event.content, availability: "free" } })],
  ["visibility", (event) => ({ ...event, content: { ...event.content, visibility: "private" } })],
];

const editedEvent = (mutate: (event: RemoteEvent) => RemoteEvent): RemoteEvent => {
  const base = foreignEvent({ id: "evt-1", uid: "evt-1", fingerprint: "fp-edited" });
  return mutate(base);
};

const planWith = (event: RemoteEvent) =>
  planReconciliation(
    sourceOnly(snapshotListing({ events: [event] })),
    knownState([knownEvent({ identity, fingerprint: "fp-original" })]),
    mappingSet([
      mapping({ identity, destinationId: "mirror-1", sourceFingerprint: "fp-original" }),
    ]),
    policy(),
  );

describe("a content edit is an update, never a delete and a create", () => {
  for (const entry of contentEdits) {
    const [field, mutate] = entry;

    test(`RECON-O33: editing ${field} plans exactly one update`, () => {
      const plan = planWith(editedEvent(mutate));
      const updates = plan.writes.filter(
        (write) => write.kind === "single" && write.intent.kind === "update",
      );

      expect(updates).toHaveLength(1);
    });

    test(`RECON-O33: editing ${field} plans zero deletes and zero creates`, () => {
      const plan = planWith(editedEvent(mutate));
      const destructive = plan.writes.filter(
        (write) =>
          write.kind === "replace" ||
          (write.kind === "single" && write.intent.kind !== "update"),
      );

      expect(destructive).toEqual([]);
      expect(plan.tombstones).toEqual([]);
    });
  }

  test("RECON-O33: editing every content field at once is still one update", () => {
    let everything: RemoteEvent = foreignEvent({ id: "evt-1", uid: "evt-1", fingerprint: "fp-edited" });
    for (const entry of contentEdits) {
      everything = entry[1](everything);
    }

    const plan = planWith(everything);

    expect(plan.writes).toHaveLength(1);
    expect(plan.tombstones).toEqual([]);
  });

  test("RECON-I9: the identity of an edited event is unchanged by the edit", () => {
    const plan = planWith(editedEvent(firstOf(contentEdits)[1]));

    expect(firstOf(plan.writes).identity).toEqual(identity);
  });
});
