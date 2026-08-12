import { describe, expect, it } from "vitest";
import { resolveCanonicalRedirect } from "../../src/server/http-handler";

describe("resolveCanonicalRedirect", () => {
  it("permanently redirects trailing-slash paths to their canonical form", () => {
    const response = resolveCanonicalRedirect(new URL("https://www.keeper.sh/blog/"));
    expect(response?.status).toBe(308);
    expect(response?.headers.get("location")).toBe("/blog");
  });

  it("preserves the query string when normalizing a trailing slash", () => {
    const response = resolveCanonicalRedirect(new URL("https://www.keeper.sh/blog/?page=2"));
    expect(response?.headers.get("location")).toBe("/blog?page=2");
  });

  it("collapses repeated trailing slashes", () => {
    const response = resolveCanonicalRedirect(new URL("https://www.keeper.sh/blog///"));
    expect(response?.headers.get("location")).toBe("/blog");
  });

  it("permanently redirects the client shell to the site root", () => {
    const response = resolveCanonicalRedirect(new URL("https://www.keeper.sh/index.html"));
    expect(response?.status).toBe(308);
    expect(response?.headers.get("location")).toBe("/");
  });

  it("leaves the root path untouched", () => {
    expect(resolveCanonicalRedirect(new URL("https://www.keeper.sh/"))).toBeNull();
  });

  it("leaves canonical paths untouched", () => {
    expect(resolveCanonicalRedirect(new URL("https://www.keeper.sh/blog"))).toBeNull();
  });
});
