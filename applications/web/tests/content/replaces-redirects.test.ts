import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { SEO_CONTENT_ROOT } from "../../src/lib/content-paths";
import { resolveMovedPath } from "../../src/lib/moved-paths";

const CONTENT_ROOT = join(import.meta.dirname, "../..", SEO_CONTENT_ROOT);
const COLLECTIONS = ["blog", "compare", "docs", "guides", "recipes"];
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/;

interface Superseded {
  from: string;
  to: string;
}

const supersededPaths = (): Superseded[] =>
  COLLECTIONS.flatMap((collection) => {
    const directory = join(CONTENT_ROOT, collection);
    if (!existsSync(directory)) return [];

    return readdirSync(directory)
      .filter((entry) => entry.endsWith(".mdx"))
      .flatMap((entry) => {
        const raw = readFileSync(join(directory, entry), "utf8").match(FRONTMATTER);
        if (!raw) return [];

        const metadata = parseYaml(raw[1]) as { replaces?: string[]; slug?: string };
        const slug = metadata.slug ?? entry.replace(/\.mdx$/, "");
        return (metadata.replaces ?? []).map((from) => ({ from, to: `/${collection}/${slug}` }));
      });
  });

const superseded = supersededPaths();

describe.skipIf(!existsSync(join(CONTENT_ROOT, "blog")))("superseded paths", () => {
  it("has paths to check", () => {
    expect(superseded.length).toBeGreaterThan(0);
  });

  it.each(superseded)("redirects $from to $to", ({ from, to }) => {
    expect(resolveMovedPath(from)).toBe(to);
  });
});
