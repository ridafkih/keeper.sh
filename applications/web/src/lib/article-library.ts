import { blogPosts, type BlogPost } from "./blog-posts";
import { comparePages } from "./compare-pages";
import { selectLatestArticles, type ArticleSummary } from "./related-articles";

const LATEST_ARTICLE_COUNT = 6;

function toArticleSummary(page: BlogPost, basePath: string): ArticleSummary {
  return {
    blurb: page.metadata.blurb,
    createdAt: page.metadata.createdAt,
    path: `${basePath}/${page.slug}`,
    tags: page.metadata.tags,
    title: page.metadata.title,
  };
}

/* Every article shares a createdAt, so byRecency returns 0 throughout and a
 * stable sort hands the whole ordering to this array. Compare pages are titled
 * after the rival, so putting them first leads every related list with a
 * competitor's brand name. */
export const articleLibrary: ArticleSummary[] = [
  ...blogPosts.map((blogPost) => toArticleSummary(blogPost, "/blog")),
  ...comparePages.map((comparePage) => toArticleSummary(comparePage, "/compare")),
];

const COMPARE_PATH_PREFIX = "/compare/";

export const latestArticles: ArticleSummary[] = selectLatestArticles(
  articleLibrary.filter((article) => !article.path.startsWith(COMPARE_PATH_PREFIX)),
  LATEST_ARTICLE_COUNT,
);
