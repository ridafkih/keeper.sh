import { describe, expect, test } from "vitest";
import { createHarness } from "../support/harness";
import { allDayContent, timedContent } from "../support/intents";

describe("normalising is a fixed point", () => {
  test("DAV-O29: normalising twice equals normalising once", () => {
    const harness = createHarness();

    const once = harness.provider.normalize(timedContent());
    if (!once.ok) {
      throw new Error(`a representable event refused normalisation as "${once.failure.kind}"`);
    }
    const twice = harness.provider.normalize(once.value.content);
    if (!twice.ok) {
      throw new Error(`a normalised event refused re-normalisation as "${twice.failure.kind}"`);
    }

    expect(twice.value.content).toEqual(once.value.content);
    expect(twice.value.fingerprint).toEqual(once.value.fingerprint);
  });

  test("DAV-O29: an all-day event is shaped once and stays shaped", () => {
    const harness = createHarness();

    const once = harness.provider.normalize(allDayContent("2026-03-21", "2026-03-24"));
    if (!once.ok) {
      throw new Error(`an all-day event refused normalisation as "${once.failure.kind}"`);
    }
    const twice = harness.provider.normalize(once.value.content);
    if (!twice.ok) {
      throw new Error(`a normalised all-day event refused re-normalisation`);
    }

    expect(twice.value.content).toEqual(once.value.content);
  });
});
