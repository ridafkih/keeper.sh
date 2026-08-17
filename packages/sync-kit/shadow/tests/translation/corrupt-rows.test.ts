import { describe, expect, test } from "vitest";
import { translateDestinationSync } from "../../src/index";
import { firstOf } from "../support/scenario";
import {
  masterIdentity,
  mirrorRow,
  shadowOptions,
  slotIdentity,
  storedSourceEvent,
  syncInput,
} from "../support/fixtures";

const healthy = slotIdentity("evt-good", "2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z");
const broken = slotIdentity("evt-bad", "2026-03-11T09:00:00.000Z", "2026-03-11T10:00:00.000Z");
const master = masterIdentity("evt-series");
const firstSlot = slotIdentity(
  "evt-series",
  "2026-03-12T09:00:00.000Z",
  "2026-03-12T10:00:00.000Z",
);
const secondSlot = slotIdentity(
  "evt-series",
  "2026-03-19T09:00:00.000Z",
  "2026-03-19T10:00:00.000Z",
);

describe("unparseable stored rows become corrupt known rows", () => {
  test("SHADOW-I23: an unparseable stored payload becomes a corrupt known row", () => {
    const translation = translateDestinationSync(
      syncInput({
        storedSourceEvents: [
          storedSourceEvent({ identity: healthy }),
          storedSourceEvent({ identity: broken, canonical: { identity: { kind: "nonsense" } } }),
        ],
        mirrors: [mirrorRow({ identity: healthy }), mirrorRow({ identity: broken })],
      }),
      shadowOptions(),
    );
    if (translation.kind !== "translated") {
      throw new Error(`expected a translation, got ${translation.reason}`);
    }
    const { known } = firstOf(translation.units);

    expect(known.corrupt.length).toBe(1);
    expect(firstOf(known.corrupt).uid?.value).toBe("evt-bad");
    expect(known.events.map((event) => event.identity.uid.value)).toEqual(["evt-good"]);
  });

  test("SHADOW-I23: a corrupt row is reported by its remote id, not dropped", () => {
    const translation = translateDestinationSync(
      syncInput({
        storedSourceEvents: [
          storedSourceEvent({ identity: broken, id: "src-bad", canonical: "not-a-record" }),
        ],
        mirrors: [mirrorRow({ identity: broken, sourceRemoteId: "src-bad" })],
      }),
      shadowOptions(),
    );
    if (translation.kind !== "translated") {
      throw new Error(`expected a translation, got ${translation.reason}`);
    }

    expect(firstOf(firstOf(translation.units).known.corrupt).id.value).toBe("src-bad");
  });

  test("SHADOW-I41: one unreadable occurrence of a uid never borrows a sibling's remote id", () => {
    const translation = translateDestinationSync(
      syncInput({
        storedSourceEvents: [
          storedSourceEvent({ identity: firstSlot, id: "src-first" }),
          storedSourceEvent({ identity: secondSlot, id: "src-second", canonical: "not-a-record" }),
        ],
        mirrors: [
          mirrorRow({ identity: firstSlot, sourceRemoteId: "src-first", destinationId: "m-first" }),
          mirrorRow({
            identity: secondSlot,
            sourceRemoteId: "src-second",
            destinationId: "m-second",
          }),
        ],
      }),
      shadowOptions(),
    );
    if (translation.kind !== "translated") {
      throw new Error(`expected a translation, got ${translation.reason}`);
    }
    const { known } = firstOf(translation.units);

    expect(known.corrupt.map((row) => row.id.value)).toEqual(["src-second"]);
  });

  test("SHADOW-I41: every mirror sharing an unreadable uid leaves known.events", () => {
    const translation = translateDestinationSync(
      syncInput({
        storedSourceEvents: [
          storedSourceEvent({ identity: master, id: "src-master", canonical: "not-a-record" }),
          storedSourceEvent({ identity: firstSlot, id: "src-first" }),
        ],
        mirrors: [
          mirrorRow({ identity: master, sourceRemoteId: "src-master", destinationId: "m-master" }),
          mirrorRow({ identity: firstSlot, sourceRemoteId: "src-first", destinationId: "m-first" }),
        ],
      }),
      shadowOptions(),
    );
    if (translation.kind !== "translated") {
      throw new Error(`expected a translation, got ${translation.reason}`);
    }
    const { known } = firstOf(translation.units);

    expect(known.events).toEqual([]);
    expect(known.corrupt.map((row) => row.id.value)).toEqual(["src-master"]);
  });
});
