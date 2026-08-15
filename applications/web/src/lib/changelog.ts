// @ts-expect-error - virtual module provided by plugins/changelog.ts
import { changelogReleases as processedReleases } from "virtual:changelog-releases";

/**
 * Every published change to Keeper.sh, newest release first.
 *
 * The content lives in `src/content/changelog`, one folder per release: an
 * `index.mdx` for the prose and a `notes.json` for the smaller changes. This
 * module only reshapes what `plugins/changelog.ts` reads off disk.
 */

export interface ChangelogRelease {
  /** Folder name, and the path segment under /changelog. */
  slug: string;
  title: string;
  description: string;
  /** Release date, ISO. Several entries can share one. */
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

export const changelogReleases: ChangelogRelease[] = processedReleases;

export function findChangelogRelease(slug: string): ChangelogRelease | undefined {
  return changelogReleases.find((release) => release.slug === slug);
}

export function changelogReleaseNeighbours(slug: string): {
  newer: ChangelogRelease | undefined;
  older: ChangelogRelease | undefined;
} {
  const index = changelogReleases.findIndex((release) => release.slug === slug);

  if (index === -1) {
    return { newer: undefined, older: undefined };
  }

  return { newer: changelogReleases[index - 1], older: changelogReleases[index + 1] };
}

export const changelogPaths: string[] = [
  "/changelog",
  ...changelogReleases.map((release) => `/changelog/${release.slug}`),
];
