import { describe, expect, it } from "vitest";
import { loggedPathFor } from "../src/tracing/request-path";

describe("the path recorded for a request", () => {
  it("names a calendar feed by its route, not by the feed it identifies", () => {
    expect(loggedPathFor("/api/cal/4f1c2a9b7d3e4c1f8a6b5d2e9c0f7a13.ics")).toBe("/api/cal/:identifier");
  });

  it("names a password reset by its route, not by the link that was followed", () => {
    expect(loggedPathFor("/api/auth/reset-password/Zx81kq0Pm3")).toBe("/api/auth/reset-password/:token");
  });

  it("leaves every other path as requested", () => {
    for (const pathname of ["/", "/dashboard", "/api/sources/abc", "/api/cal", "/api/auth/reset-password", "/mcp"]) {
      expect(loggedPathFor(pathname)).toBe(pathname);
    }
  });
});
