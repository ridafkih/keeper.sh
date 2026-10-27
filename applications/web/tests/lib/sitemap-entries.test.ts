import { describe, expect, it } from "vitest";
import { dedupeSitemapEntries } from "@/lib/sitemap-entries";

describe("dedupeSitemapEntries", () => {
  it("keeps one entry per path and prefers the later one", () => {
    const entries = dedupeSitemapEntries([
      { path: "/docs", lastmod: "2026-08-14" },
      { path: "/blog", lastmod: "2026-09-01" },
      { path: "/docs", lastmod: "2026-10-01" },
    ]);

    expect(entries).toEqual([
      { path: "/docs", lastmod: "2026-10-01" },
      { path: "/blog", lastmod: "2026-09-01" },
    ]);
  });
});
