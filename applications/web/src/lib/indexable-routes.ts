const INDEXABLE_ROUTE_GROUP = "/(marketing)";
const ROUTES_BY_ID_PATTERN = /export interface FileRoutesById \{\n([\s\S]*?)\n\}/;
const ROUTE_ID_PATTERN = /^ +'([^']+)':/gm;

/**
 * Collects the static, indexable paths TanStack Router generated, so a new
 * marketing route cannot ship without a sitemap entry. Dynamic segments are
 * left out because their pages come from content rather than the route tree.
 */
export function parseIndexableRoutePaths(routeTreeSource: string): string[] {
  const routesById = routeTreeSource.match(ROUTES_BY_ID_PATTERN);
  if (!routesById) {
    throw new Error("The generated route tree is missing its FileRoutesById map.");
  }

  const paths = new Set<string>();
  for (const [, routeId] of routesById[1].matchAll(ROUTE_ID_PATTERN)) {
    if (!routeId.startsWith(INDEXABLE_ROUTE_GROUP) || routeId.includes("$")) continue;
    const path = routeId.slice(INDEXABLE_ROUTE_GROUP.length).replace(/\/$/, "");
    paths.add(path === "" ? "/" : path);
  }

  return [...paths].sort();
}

export function assertIndexableRoutesCovered(
  coveredPaths: string[],
  routePaths: string[],
): void {
  const covered = new Set(coveredPaths);
  const routes = new Set(routePaths);

  const missing = routePaths.filter((path) => !covered.has(path));
  if (missing.length > 0) {
    throw new Error(
      `Indexable routes are missing from the sitemap: ${missing.join(", ")}. Add them to staticPageMetadata in src/lib/page-metadata.ts.`,
    );
  }

  const unknown = coveredPaths.filter((path) => !routes.has(path));
  if (unknown.length > 0) {
    throw new Error(
      `The sitemap lists paths that are not indexable routes: ${unknown.join(", ")}. Remove them from staticPageMetadata in src/lib/page-metadata.ts.`,
    );
  }
}
