import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { type } from "arktype";
import { parse as parseYaml } from "yaml";

/**
 * One entry is one folder: `index.mdx` carries the prose that explains what
 * changed, and `notes.json` carries the smaller changes as three lists of full
 * sentences. The folder name is the entry's slug, which is also its URL.
 *
 * The entry is the unit, not the release. Several entries can share a date, and
 * the timeline repeats that date rather than batching them into one row.
 */

const releaseMetadataSchema = type({
  title: "string",
  description: "string",
  date: "string",
  version: "string",
  position: "number",
});

const releaseNotesSchema = type({
  features: "string[]",
  improvements: "string[]",
  fixes: "string[]",
});

export interface ChangelogRelease {
  /** Folder name, and the path segment under /changelog. */
  slug: string;
  title: string;
  description: string;
  /** Release date, ISO. Not unique — several entries can share one. */
  date: string;
  /** The release this shipped in, e.g. "v2.15.0". */
  version: string;
  /** Orders entries that share a date, lowest first. */
  position: number;
  content: string;
  features: string[];
  improvements: string[];
  fixes: string[];
}

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function splitFrontmatter(raw: string, filePath: string) {
  const match = FRONTMATTER_PATTERN.exec(raw);

  if (!match?.[1]) {
    throw new Error(`Missing frontmatter in ${filePath}.`);
  }

  return { content: raw.slice(match[0].length).trim(), data: parseYaml(match[1]) };
}

function readRelease(directory: string, slug: string): ChangelogRelease {
  const indexPath = join(directory, "index.mdx");
  const notesPath = join(directory, "notes.json");

  if (!existsSync(indexPath)) {
    throw new Error(`Changelog release "${slug}" has no index.mdx.`);
  }

  if (!existsSync(notesPath)) {
    throw new Error(`Changelog release "${slug}" has no notes.json.`);
  }

  const { content, data } = splitFrontmatter(readFileSync(indexPath, "utf-8"), indexPath);
  const metadata = releaseMetadataSchema(data);

  if (metadata instanceof type.errors) {
    throw new Error(`Invalid frontmatter in ${indexPath}: ${metadata.summary}`);
  }

  const notes = releaseNotesSchema(JSON.parse(readFileSync(notesPath, "utf-8")));

  if (notes instanceof type.errors) {
    throw new Error(`Invalid notes in ${notesPath}: ${notes.summary}`);
  }

  for (const [kind, list] of Object.entries(notes)) {
    for (const sentence of list as string[]) {
      if (!sentence.trim().endsWith(".")) {
        throw new Error(
          `Changelog ${kind} note in ${slug} is not a full sentence: ${JSON.stringify(sentence)}`,
        );
      }
    }
  }

  return {
    slug,
    title: metadata.title,
    description: metadata.description,
    date: metadata.date,
    version: metadata.version,
    position: metadata.position,
    content,
    features: notes.features,
    improvements: notes.improvements,
    fixes: notes.fixes,
  };
}

export function processChangelogDirectory(changelogDir: string): ChangelogRelease[] {
  /* Changelog ships in the optional `seo` submodule. An unfetched directory
   * means no releases, not a broken build. */
  if (!existsSync(changelogDir)) return [];

  const slugs = readdirSync(changelogDir).filter((entry) =>
    statSync(join(changelogDir, entry)).isDirectory(),
  );

  const releases = slugs.map((slug) => readRelease(join(changelogDir, slug), slug));

  const seen = new Set<string>();
  for (const release of releases) {
    const key = `${release.date}#${release.position}`;
    if (seen.has(key)) {
      throw new Error(
        `Two changelog entries share ${release.date} at position ${release.position}. Give each entry on a date its own position, lowest first.`,
      );
    }
    seen.add(key);
  }

  return releases.sort(
    (a, b) => b.date.localeCompare(a.date) || a.position - b.position,
  );
}
