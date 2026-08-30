import { describe, expect, it } from "vitest";
import { staticAssetSitemapPaths } from "../../plugins/sitemap";
import { staticPageMetadata } from "../../src/lib/page-metadata";
import { staticPagePaths } from "../../src/lib/static-page-paths";

describe("staticPagePaths", () => {
  it("covers every page the sitemap publishes, so none skips the HTML cache", () => {
    const sitemapPaths = staticPageMetadata.map(({ path }) => path);

    expect([...staticPagePaths].sort()).toEqual([...sitemapPaths].sort());
  });

  it("lists each path once", () => {
    expect(new Set(staticPagePaths).size).toBe(staticPagePaths.length);
  });
});

describe("staticAssetSitemapPaths", () => {
  it("publishes llms.txt in the sitemap without putting it on the HTML cache list", () => {
    expect([...staticAssetSitemapPaths]).toEqual(["/llms.txt"]);
    expect(staticPagePaths).not.toContain("/llms.txt");
  });
});
