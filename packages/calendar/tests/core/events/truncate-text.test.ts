import { describe, expect, it } from "vitest";
import { truncateToCodeUnits } from "../../../src/core/events/truncate-text";

describe("truncateToCodeUnits", () => {
  it("returns a value within the limit unchanged", () => {
    expect(truncateToCodeUnits("agenda", 6)).toBe("agenda");
  });

  it("cuts a longer value to the limit", () => {
    expect(truncateToCodeUnits("agenda notes", 6)).toBe("agenda");
  });

  it("drops a surrogate pair the limit would split", () => {
    expect(truncateToCodeUnits("ab\u{1F4C5}cd", 3)).toBe("ab");
  });

  it("keeps a surrogate pair that ends on the limit", () => {
    expect(truncateToCodeUnits("ab\u{1F4C5}cd", 4)).toBe("ab\u{1F4C5}");
  });

  it("is a fixed point", () => {
    const once = truncateToCodeUnits("ab\u{1F4C5}cd", 3);
    expect(truncateToCodeUnits(once, 3)).toBe(once);
  });
});
