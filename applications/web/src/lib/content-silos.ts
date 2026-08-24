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
      "What every Keeper.sh setting does. Linked accounts, sending events to another calendar, which event details travel with a copy, and how far back and ahead the copying reaches.",
    id: "docs",
    name: "Docs",
    pages: processedDocs,
    tagline: "What each setting does",
  },
  guides: {
    basePath: "/guides",
    description:
      "Fixes for calendar sync, each one starting from what you can see. Events that read Busy, copies that have not turned up, the same meeting twice, a subscribed link that lags behind.",
    id: "guides",
    name: "Guides",
    pages: processedGuides,
    tagline: "Start from the symptom",
  },
  recipes: {
    basePath: "/recipes",
    description:
      "Ready-made Keeper.sh setups you can copy. Each one lists the connections and settings it needs, and the plan it runs on.",
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
