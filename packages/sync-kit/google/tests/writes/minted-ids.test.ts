import { describe, expect, test } from "vitest";
import { createMintedEventIds } from "../../src/write/minted-ids";

describe("the ids we minted are remembered, but never without a bound", () => {
  test("GOOG-O40: an id the adapter minted is recognised afterwards", () => {
    const minted = createMintedEventIds(4);

    minted.remember("an-id-we-minted");

    expect(minted.known().has("an-id-we-minted")).toBe(true);
  });

  test("GOOG-O40: the memory never grows past its capacity", () => {
    const minted = createMintedEventIds(4);

    for (const position of [1, 2, 3, 4, 5, 6, 7, 8]) {
      minted.remember(`minted-${position}`);
    }

    expect(minted.size()).toBe(4);
    expect(minted.known().has("minted-8")).toBe(true);
    expect(minted.known().has("minted-1")).toBe(false);
  });

  test("GOOG-O40: re-minting the same id keeps it, rather than filling the memory with copies", () => {
    const minted = createMintedEventIds(2);

    minted.remember("same-id");
    minted.remember("other-id");
    minted.remember("same-id");
    minted.remember("third-id");

    expect(minted.known().has("same-id")).toBe(true);
    expect(minted.size()).toBe(2);
  });
});
