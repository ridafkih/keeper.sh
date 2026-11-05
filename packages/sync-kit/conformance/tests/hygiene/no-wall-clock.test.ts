import { describe, expect, test } from "vitest";
import { createTestClock } from "../../src/clock";
import { filesMatching } from "../support/sources";
import { suiteStart } from "../support/harness";

const spelledInPieces = (pieces: readonly string[]): string => pieces.join(".");

const readingsThisFileMustNotSpellOutItself = [
  spelledInPieces(["Date", "now()"]),
  spelledInPieces(["performance", "now()"]),
];

describe("a deadline is asserted on the fake clock, never on the CI agent", () => {
  test.each(readingsThisFileMustNotSpellOutItself)("CONF-I53: no file under src reads %s", async (reading) => {
    const offenders = await filesMatching("src", reading);

    expect(offenders).toEqual([]);
  });

  test.each(readingsThisFileMustNotSpellOutItself)("CONF-I53: no test file reads %s", async (reading) => {
    const offenders = await filesMatching("tests", reading);

    expect(offenders).toEqual([]);
  });

  test("CONF-I53: advancing the injected clock moves its own now, not the machine's", async () => {
    const clock = createTestClock({ start: suiteStart });
    const before = clock.now();

    await clock.advance(5000);

    expect(clock.now()).not.toEqual(before);
    expect(Date.parse(clock.now().value) - Date.parse(before.value)).toBe(5000);
  });
});
