/**
 * Mounted inside this package rather than at the repository root so `turbo prune`
 * carries it into the Docker build; prune emits whole workspace packages.
 */
export const SEO_CONTENT_ROOT = "seo";

export const CONTENT_DIRECTORIES = {
  blog: `${SEO_CONTENT_ROOT}/blog`,
  changelog: `${SEO_CONTENT_ROOT}/changelog`,
  compare: `${SEO_CONTENT_ROOT}/compare`,
  docs: `${SEO_CONTENT_ROOT}/docs`,
  guides: `${SEO_CONTENT_ROOT}/guides`,
  recipes: `${SEO_CONTENT_ROOT}/recipes`,
} as const;

export const MOVED_PATHS_FILE = "moved-paths.json";

export interface SupersedingPage {
  basePath: string;
  replaces?: string[];
  slug: string;
}

export function buildMovedPaths(pages: SupersedingPage[]): Record<string, string> {
  const moved: Record<string, string> = {};

  for (const page of pages) {
    for (const from of page.replaces ?? []) {
      const to = `${page.basePath}/${page.slug}`;

      if (from === to) {
        throw new Error(`"${from}" redirects to itself.`);
      }

      if (moved[from] && moved[from] !== to) {
        throw new Error(`"${from}" is claimed by both "${moved[from]}" and "${to}".`);
      }

      moved[from] = to;
    }
  }

  return moved;
}
