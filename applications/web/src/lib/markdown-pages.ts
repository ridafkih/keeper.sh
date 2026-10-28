import { blogPosts, type BlogPost } from "./blog-posts";
import { comparePages } from "./compare-pages";
import { contentSiloList } from "./content-silos";
import { toMarkdownDocument } from "./markdown-document";

interface MarkdownCollection {
  basePath: string;
  pages: BlogPost[];
}

const markdownCollections: MarkdownCollection[] = [
  { basePath: "/blog", pages: blogPosts },
  { basePath: "/compare", pages: comparePages },
  ...contentSiloList.map(({ basePath, pages }) => ({ basePath, pages })),
];

function findMarkdownSource(path: string): BlogPost | undefined {
  const collection = markdownCollections.find(({ basePath }) => path.startsWith(`${basePath}/`));
  if (!collection) return undefined;

  const slug = path.slice(collection.basePath.length + 1);
  return collection.pages.find((page) => page.slug === slug);
}

export function renderMarkdownPage(path: string): string | null {
  const page = findMarkdownSource(path);
  if (!page) return null;

  return toMarkdownDocument({
    content: page.content,
    description: page.metadata.description,
    path,
    title: page.metadata.title,
    updatedAt: page.metadata.updatedAt,
  });
}
