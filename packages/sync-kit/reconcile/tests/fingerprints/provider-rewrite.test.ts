import type { EditableContent, RemoteEvent } from "@keeper.sh/sync-protocol";
import { describe, expect, test } from "vitest";
import { planReconciliation } from "../../src/index";
import {
  bothSides,
  destinationCalendar,
  destinationScope,
  foreignEvent,
  knownEvent,
  knownState,
  mapping,
  mappingSet,
  ourInstallation,
  ownedEvent,
  policy,
  slotIdentity,
  snapshotListing,
  timedAt,
} from "../support/fixtures";

const span = { start: "2026-03-10T09:00:00.000Z", end: "2026-03-10T10:00:00.000Z" };
const identity = slotIdentity("evt-1", span.start, span.end);

const singleOccurrence = (
  event: RemoteEvent,
  overrides: Partial<Extract<EditableContent, { recurrence: null }>>,
): RemoteEvent => ({
  ...event,
  content: {
    title: event.content.title,
    description: event.content.description,
    location: event.content.location,
    availability: event.content.availability,
    visibility: event.content.visibility,
    recurrence: null,
    time: timedAt(span.start, span.end),
    ...overrides,
  },
});

const rewrites: readonly (readonly [string, (event: RemoteEvent) => RemoteEvent])[] = [
  [
    "CRLF line endings in the description",
    (event) => singleOccurrence(event, { description: "line one\r\nline two" }),
  ],
  [
    "a trailing space appended to the title",
    (event) => singleOccurrence(event, { title: `${event.content.title} ` }),
  ],
  [
    "sub-second precision dropped from the start",
    (event) => singleOccurrence(event, { time: timedAt("2026-03-10T09:00:00.500Z", span.end) }),
  ],
  ["availability coerced by the destination", (event) => singleOccurrence(event, { availability: "busy" })],
];

const mirrorRewrittenBy = (mutate: (event: RemoteEvent) => RemoteEvent): RemoteEvent =>
  mutate(
    ownedEvent(
      { id: "mirror-1", uid: "mirror-1", calendar: destinationCalendar, fingerprint: "mirror-evt-1" },
      ourInstallation,
    ),
  );

const planAgainstRewrite = (mutate: (event: RemoteEvent) => RemoteEvent) =>
  planReconciliation(
    bothSides(
      snapshotListing({ events: [foreignEvent({ id: "evt-1", uid: "evt-1", fingerprint: "fp-evt-1" })] }),
      snapshotListing({ events: [mirrorRewrittenBy(mutate)], scope: destinationScope }),
    ),
    knownState([knownEvent({ identity, fingerprint: "fp-evt-1" })]),
    mappingSet([
      mapping({
        identity,
        destinationId: "mirror-1",
        sourceFingerprint: "fp-evt-1",
        mirrorFingerprint: "mirror-evt-1",
      }),
    ]),
    policy(),
  );

describe("a destination's own rewrite is not a user edit", () => {
  for (const entry of rewrites) {
    const [name, mutate] = entry;

    test(`RECON-O21: ${name} does not make the source row look changed`, () => {
      const plan = planAgainstRewrite(mutate);

      expect(plan.writes).toEqual([]);
    });

    test(`RECON-O21: ${name} raises no conflict either`, () => {
      const plan = planAgainstRewrite(mutate);

      expect(plan.conflicts).toEqual([]);
    });
  }

  test("RECON-O21: a genuine mirror edit, carrying a different mirror fingerprint, IS a conflict", () => {
    const handEdited = (event: RemoteEvent): RemoteEvent => ({
      ...singleOccurrence(event, { title: "someone typed this" }),
      fingerprint: { kind: "fingerprint", value: "mirror-hand-edited" },
    });

    const plan = planAgainstRewrite(handEdited);

    expect(plan.conflicts).toHaveLength(1);
    expect(plan.writes).toEqual([]);
  });
});
