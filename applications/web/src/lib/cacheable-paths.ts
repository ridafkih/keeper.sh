import { blogPosts } from "./blog-posts";
import { comparePages } from "./compare-pages";

const marketingPaths = ["/", "/blog", "/compare", "/privacy", "/terms"];

export const cacheableHtmlPaths: string[] = [
  ...marketingPaths,
  ...blogPosts.map((blogPost) => `/blog/${blogPost.slug}`),
  ...comparePages.map((comparePage) => `/compare/${comparePage.slug}`),
];
