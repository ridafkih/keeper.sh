import { describe, expect, test } from "vitest";
import { filesMatchingPattern } from "../support/sources";

const rawResponse = /\bResponse\b/;

describe("a raw Response never escapes the client layer", () => {
  test("DAV-H20: only src/client holds a raw Response", async () => {
    const holders = await filesMatchingPattern("src", rawResponse);
    const outsideTheClient = holders.filter((file) => !file.startsWith("src/client/"));

    expect(outsideTheClient).toEqual([]);
    expect(holders.length).toBeGreaterThan(0);
  });

  test("DAV-H20: the listing, write and report layers name no headers of their own", async () => {
    const headerReaders = await filesMatchingPattern("src", /new Headers\(|\.headers\.get\(/);
    const outsideTheClient = headerReaders.filter((file) => !file.startsWith("src/client/"));

    expect(outsideTheClient).toEqual([]);
  });
});
