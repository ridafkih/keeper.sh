import { blogPosts } from "./blog-posts";
import { staticPagePaths } from "./static-page-paths";

export const cacheableHtmlPaths: string[] = [
  ...staticPagePaths,
  "/blog",
  ...blogPosts.map((blogPost) => `/blog/${blogPost.slug}`),
];
