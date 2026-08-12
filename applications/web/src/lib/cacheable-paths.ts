import { blogPosts } from "./blog-posts";

const marketingPaths = ["/", "/blog", "/privacy", "/terms"];

export const cacheableHtmlPaths: string[] = [
  ...marketingPaths,
  ...blogPosts.map((blogPost) => `/blog/${blogPost.slug}`),
];
