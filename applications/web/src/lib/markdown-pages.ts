import { blogPosts, type BlogPost } from "./blog-posts";
import { comparePages } from "./compare-pages";
import { contentSiloList } from "./content-silos";
import { toMarkdownDocument } from "./markdown-document";
import { getServerPublicRuntimeConfig } from "./runtime-config";

interface MarkdownCollection {
  basePath: string;
  pages: BlogPost[];
}

const markdownCollections: MarkdownCollection[] = [
  { basePath: "/blog", pages: blogPosts },
  { basePath: "/compare", pages: comparePages },
  ...contentSiloList.map(({ basePath, pages }) => ({ basePath, pages })),
];

const markdownPages = new Map(
  markdownCollections.flatMap(({ basePath, pages }) =>
    pages.map((page) => {
      const path = `${basePath}/${page.slug}`;
      const document = toMarkdownDocument({
        content: page.content,
        description: page.metadata.description,
        path,
        title: page.metadata.title,
        updatedAt: page.metadata.updatedAt,
      });
      return [path, document] as const;
    }),
  ),
);

export function renderMarkdownPage(path: string): string | null {
  if (!getServerPublicRuntimeConfig({ environment: process.env }).commercialMode) return null;
  return markdownPages.get(path) ?? null;
}
