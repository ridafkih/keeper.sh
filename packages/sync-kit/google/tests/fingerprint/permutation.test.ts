import type { EditableContent } from "@keeper.sh/sync-protocol";
import { describe, expect, test } from "vitest";
import { canonicalEncoding, fingerprintContent } from "../../src/fingerprint";
import { createHarness } from "../support/harness";

const insertionOrderOne: EditableContent = {
  title: "Standup",
  description: null,
  location: null,
  availability: "busy",
  visibility: "default",
  recurrence: null,
  time: {
    kind: "timed",
    start: { kind: "instant", value: "2026-03-21T09:00:00.000Z" },
    end: { kind: "instant", value: "2026-03-21T09:15:00.000Z" },
    zone: { kind: "zoneId", value: "UTC" },
  },
};

const insertionOrderTwo: EditableContent = {
  time: {
    end: { value: "2026-03-21T09:15:00.000Z", kind: "instant" },
    start: { value: "2026-03-21T09:00:00.000Z", kind: "instant" },
    zone: { value: "UTC", kind: "zoneId" },
    kind: "timed",
  },
  recurrence: null,
  visibility: "default",
  availability: "busy",
  location: null,
  description: null,
  title: "Standup",
};

describe("change detection survives key order", () => {
  test("GOOG-O21: two key orders of one content produce one fingerprint", () => {
    const harness = createHarness();

    const first = fingerprintContent(insertionOrderOne, harness.environment.hash);
    const second = fingerprintContent(insertionOrderTwo, harness.environment.hash);

    expect(second).toEqual(first);
  });

  test("GOOG-O21: the canonical encoding itself is byte-identical across key orders", () => {
    expect(canonicalEncoding(insertionOrderTwo)).toBe(canonicalEncoding(insertionOrderOne));
  });

  test("GOOG-O21: a content change still changes the fingerprint", () => {
    const harness = createHarness();

    const changed = fingerprintContent(
      { ...insertionOrderOne, title: "Standup (moved)" },
      harness.environment.hash,
    );

    expect(changed).not.toEqual(fingerprintContent(insertionOrderOne, harness.environment.hash));
  });

  test("GOOG-O21: the fingerprint carries no provider identity", () => {
    const harness = createHarness();

    const fingerprint = fingerprintContent(insertionOrderOne, harness.environment.hash);

    expect(fingerprint.value).not.toContain("google");
  });
});
