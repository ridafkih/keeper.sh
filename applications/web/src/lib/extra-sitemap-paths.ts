/**
 * Public static files that are not HTML routes. `plugins/sitemap.ts` appends
 * these after the indexable-route check, so they can ship without a matching
 * TanStack route or HTML cache entry.
 */
export const extraSitemapPaths = ["/llms.txt"] as const;
