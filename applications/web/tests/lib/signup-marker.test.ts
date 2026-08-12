import { describe, expect, it } from "vitest";
import { stripSignupMarker, withSignupMarker } from "@/lib/signup-marker";

const origin = "https://www.keeper.sh";

describe("withSignupMarker", () => {
  it("marks a relative post-auth path", () => {
    expect(withSignupMarker("/dashboard", origin)).toBe("/dashboard?keeper_signup=1");
  });

  it("keeps existing query parameters", () => {
    expect(withSignupMarker("/dashboard?tab=sources", origin)).toBe(
      "/dashboard?tab=sources&keeper_signup=1",
    );
  });

  it("leaves cross-origin authorization redirects untouched", () => {
    const target = "https://api.keeper.sh/mcp/authorize?client_id=abc";

    expect(withSignupMarker(target, origin)).toBe(target);
  });
});

describe("stripSignupMarker", () => {
  it("returns the cleaned url when the marker is present", () => {
    expect(stripSignupMarker(`${origin}/dashboard?keeper_signup=1`)).toBe("/dashboard");
  });

  it("preserves unrelated query parameters and the hash", () => {
    expect(stripSignupMarker(`${origin}/dashboard?keeper_signup=1&tab=sources#feeds`)).toBe(
      "/dashboard?tab=sources#feeds",
    );
  });

  it("returns null when the marker is absent", () => {
    expect(stripSignupMarker(`${origin}/dashboard?tab=sources`)).toBeNull();
  });
});
