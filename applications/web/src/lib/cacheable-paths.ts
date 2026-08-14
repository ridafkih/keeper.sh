import { blogPosts } from "./blog-posts";
import { comparePages } from "./compare-pages";
import { contentSiloList } from "./content-silos";

const marketingPaths = [
  "/",
  "/blog",
  "/compare",
  "/docs",
  "/guides",
  "/privacy",
  "/recipes",
  "/terms",
];

export const cacheableHtmlPaths: string[] = [
  ...marketingPaths,
  ...blogPosts.map((blogPost) => `/blog/${blogPost.slug}`),
  ...comparePages.map((comparePage) => `/compare/${comparePage.slug}`),
  ...contentSiloList.flatMap((silo) =>
    silo.pages.map((page) => `${silo.basePath}/${page.slug}`),
  ),
];
