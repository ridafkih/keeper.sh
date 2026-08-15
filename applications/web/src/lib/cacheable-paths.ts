import { blogPosts } from "./blog-posts";
import { comparePages } from "./compare-pages";
import { contentSiloList } from "./content-silos";
import { staticPagePaths } from "./static-page-paths";

const siloIndexPaths = ["/blog", "/compare", "/docs", "/guides", "/recipes"];

export const cacheableHtmlPaths: string[] = [
  ...staticPagePaths,
  ...siloIndexPaths,
  ...blogPosts.map((blogPost) => `/blog/${blogPost.slug}`),
  ...comparePages.map((comparePage) => `/compare/${comparePage.slug}`),
  ...contentSiloList.flatMap((silo) =>
    silo.pages.map((page) => `${silo.basePath}/${page.slug}`),
  ),
];
