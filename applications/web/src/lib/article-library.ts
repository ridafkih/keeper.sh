import { blogPosts, type BlogPost } from "./blog-posts";
import { comparePages } from "./compare-pages";
import { selectLatestArticles, type ArticleSummary } from "./related-articles";

const LATEST_GUIDE_COUNT = 6;

function toArticleSummary(page: BlogPost, basePath: string): ArticleSummary {
  return {
    blurb: page.metadata.blurb,
    createdAt: page.metadata.createdAt,
    path: `${basePath}/${page.slug}`,
    tags: page.metadata.tags,
    title: page.metadata.title,
  };
}

export const articleLibrary: ArticleSummary[] = [
  ...comparePages.map((comparePage) => toArticleSummary(comparePage, "/compare")),
  ...blogPosts.map((blogPost) => toArticleSummary(blogPost, "/blog")),
];

export const latestGuides: ArticleSummary[] = selectLatestArticles(
  articleLibrary,
  LATEST_GUIDE_COUNT,
);
