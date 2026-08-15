/**
 * Every static marketing page, kept in step with `staticPageMetadata` in
 * `src/lib/page-metadata.ts`, which `plugins/sitemap.ts` reads to build the sitemap.
 * `tests/lib/static-page-paths.test.ts` fails if the two ever disagree, so a page
 * cannot be published to the sitemap and quietly left out of the public HTML cache.
 */
export const staticPagePaths: string[] = [
  "/",
  "/features",
  "/pricing",
  "/self-hosting",
  "/about",
  "/tools/ics-generator",
  "/tools/ics-viewer",
  "/docs",
  "/docs/mcp",
  "/guides",
  "/recipes",
  "/compare",
  "/privacy",
  "/terms",
];
