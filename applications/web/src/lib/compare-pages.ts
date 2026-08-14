// @ts-expect-error - virtual module provided by plugins/blog.ts
import { comparePages as processedPages } from "virtual:compare-pages";
import type { BlogPost } from "./blog-posts";

export type ComparePage = BlogPost;

export const comparePages: ComparePage[] = processedPages;

export function findComparePageBySlug(slug: string): ComparePage | undefined {
  return comparePages.find((comparePage) => comparePage.slug === slug);
}
