// @ts-expect-error - virtual module provided by plugins/blog.ts
import { docsPages as processedDocs } from "virtual:docs-pages";
// @ts-expect-error - virtual module provided by plugins/blog.ts
import { guidesPages as processedGuides } from "virtual:guides-pages";
// @ts-expect-error - virtual module provided by plugins/blog.ts
import { recipesPages as processedRecipes } from "virtual:recipes-pages";
import type { BlogPost } from "./blog-posts";
import type { ArticleSummary } from "./related-articles";

export type ContentSiloId = "docs" | "guides" | "recipes";

export interface ContentSilo {
  basePath: string;
  description: string;
  id: ContentSiloId;
  name: string;
  pages: BlogPost[];
  tagline: string;
}

export const contentSilos: Record<ContentSiloId, ContentSilo> = {
  docs: {
    basePath: "/docs",
    description:
      "Reference for every Keeper.sh setting: what a linked account is, what a connection copies, which event details reach the other calendar, and how far ahead and behind a sync reaches.",
    id: "docs",
    name: "Docs",
    pages: processedDocs,
    tagline: "What each setting does",
  },
  guides: {
    basePath: "/guides",
    description:
      "Fixes for the things that go wrong with calendar sync, each one starting from the symptom you can see: events that read Busy, copies that have not turned up yet, the same meeting twice, a feed that lags behind.",
    id: "guides",
    name: "Guides",
    pages: processedGuides,
    tagline: "Start from the symptom",
  },
  recipes: {
    basePath: "/recipes",
    description:
      "Ready-made Keeper.sh setups you can copy, each one written as the connections and settings it needs, and each labelled with the plan it runs on.",
    id: "recipes",
    name: "Recipes",
    pages: processedRecipes,
    tagline: "Setups you can copy",
  },
};

export const contentSiloList: ContentSilo[] = [
  contentSilos.docs,
  contentSilos.guides,
  contentSilos.recipes,
];

export function findSiloPageBySlug(
  silo: ContentSilo,
  slug: string,
): BlogPost | undefined {
  return silo.pages.find((page) => page.slug === slug);
}

export function siloArticleSummaries(silo: ContentSilo): ArticleSummary[] {
  return silo.pages.map((page) => ({
    blurb: page.metadata.blurb,
    createdAt: page.metadata.createdAt,
    path: `${silo.basePath}/${page.slug}`,
    tags: page.metadata.tags,
    title: page.metadata.title,
  }));
}

export function otherContentSilos(silo: ContentSilo): ContentSilo[] {
  return contentSiloList.filter((candidate) => candidate.id !== silo.id);
}
