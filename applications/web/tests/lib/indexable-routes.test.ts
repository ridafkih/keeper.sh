import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assertIndexableRoutesCovered,
  parseIndexableRoutePaths,
} from "@/lib/indexable-routes";
import { staticPageMetadata } from "@/lib/page-metadata";

const ROUTE_TREE_FILE = resolve(
  fileURLToPath(import.meta.url),
  "../../../src/generated/tanstack/route-tree.generated.ts",
);

const routeTree = `export interface FileRoutesById {
  __root__: typeof rootRouteImport
  '/(auth)': typeof authRouteRouteWithChildren
  '/(marketing)': typeof marketingRouteRouteWithChildren
  '/(marketing)/blog': typeof marketingBlogRouteRouteWithChildren
  '/(auth)/login': typeof authLoginRoute
  '/(marketing)/features': typeof marketingFeaturesRoute
  '/(marketing)/': typeof marketingIndexRoute
  '/(marketing)/blog/$slug': typeof marketingBlogSlugRoute
  '/(marketing)/blog/': typeof marketingBlogIndexRoute
  '/(dashboard)/dashboard/': typeof dashboardDashboardIndexRoute
}
export interface FileRouteTypes {
  fileRoutesByFullPath: FileRoutesByFullPath
}
`;

describe("parseIndexableRoutePaths", () => {
  it("lists the marketing routes as the paths they are served at", () => {
    expect(parseIndexableRoutePaths(routeTree)).toEqual([
      "/",
      "/blog",
      "/features",
    ]);
  });

  it("leaves out routes that are not publicly indexable", () => {
    const paths = parseIndexableRoutePaths(routeTree);
    expect(paths).not.toContain("/login");
    expect(paths).not.toContain("/dashboard");
  });

  it("leaves out dynamic routes, whose pages come from content", () => {
    expect(parseIndexableRoutePaths(routeTree)).not.toContain("/blog/$slug");
  });

  it("rejects a route tree it cannot read the routes from", () => {
    expect(() => parseIndexableRoutePaths("export const routeTree = {}")).toThrow(
      /FileRoutesById/,
    );
  });
});

describe("assertIndexableRoutesCovered", () => {
  it("accepts a sitemap that covers every indexable route", () => {
    expect(() =>
      assertIndexableRoutesCovered(["/", "/features"], ["/", "/features"]),
    ).not.toThrow();
  });

  it("names the indexable routes the sitemap leaves out", () => {
    expect(() =>
      assertIndexableRoutesCovered(["/"], ["/", "/features", "/pricing"]),
    ).toThrow(/\/features, \/pricing/);
  });

  it("names the sitemap paths that no longer have a route", () => {
    expect(() => assertIndexableRoutesCovered(["/", "/beta"], ["/"])).toThrow(
      /\/beta/,
    );
  });
});

describe("the shipped page metadata", () => {
  it("covers every indexable route in the generated route tree", () => {
    const coveredPaths = [...staticPageMetadata.map((page) => page.path), "/blog"];
    const routePaths = parseIndexableRoutePaths(readFileSync(ROUTE_TREE_FILE, "utf-8"));

    expect(routePaths.length).toBeGreaterThan(0);
    expect(() => assertIndexableRoutesCovered(coveredPaths, routePaths)).not.toThrow();
  });
});
