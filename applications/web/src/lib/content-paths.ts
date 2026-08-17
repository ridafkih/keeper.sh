/**
 * Where each content collection lives, relative to the Vite root
 * (`applications/web`).
 *
 * These directories come from the `seo` submodule, which is optional: a clone
 * that never fetched it still builds, and every collection is simply empty. The
 * plugins that read them treat an absent directory as an empty collection
 * rather than an error.
 *
 * The submodule is mounted inside this package rather than at the repository
 * root so `turbo prune` carries it into the Docker build — prune emits whole
 * workspace packages, and a root-level directory would be dropped.
 *
 * Four plugins resolve these paths — blog, sitemap, feed and changelog. Keeping
 * them in one place is what stops a collection moving in one of them and
 * silently vanishing from the sitemap in another.
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
