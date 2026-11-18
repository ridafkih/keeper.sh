import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { collectContentImages } from "../../src/lib/content-images";
import { SEO_CONTENT_ROOT } from "../../src/lib/content-paths";

const CONTENT_ROOT = join(import.meta.dirname, "../..", SEO_CONTENT_ROOT);
const CONTENT_PRESENT = existsSync(join(CONTENT_ROOT, "blog"));

const pages = ["blog", "compare", "docs", "guides", "recipes"]
  .map((collection) => join(CONTENT_ROOT, collection))
  .filter((directory) => existsSync(directory))
  .flatMap((directory) =>
    readdirSync(directory)
      .filter((entry) => entry.endsWith(".mdx"))
      .map((entry) => join(directory, entry)),
  );

describe.skipIf(!CONTENT_PRESENT)("content images", () => {
  it.each(pages)("every image has alt text and a file in %s", (page) => {
    expect(() => collectContentImages(readFileSync(page, "utf8"), page, CONTENT_ROOT)).not.toThrow();
  });
});
