export interface ArticleSummary {
  blurb: string;
  createdAt: string;
  path: string;
  tags: string[];
  title: string;
}

const RELATED_ARTICLE_COUNT = 3;
const COMPARE_PATH_PREFIX = "/compare/";

function countSharedTags(tags: string[], otherTags: string[]): number {
  return tags.filter((tag) => otherTags.includes(tag)).length;
}

function byRecency(article: ArticleSummary, other: ArticleSummary): number {
  return other.createdAt.localeCompare(article.createdAt);
}

function pathContains(article: ArticleSummary, fragment: string): boolean {
  return article.path.toLowerCase().includes(fragment);
}

function isCompareArticle(article: ArticleSummary): boolean {
  return article.path.startsWith(COMPARE_PATH_PREFIX);
}

/* Claude/MCP funnel posts (and any future path with mcp/claude, or mcp tag)
 * stay off the homepage Latest roll. /docs/mcp is a static page, not a blog
 * post, so it never enters this picker. */
function isMcpFunnelArticle(article: ArticleSummary): boolean {
  return (
    pathContains(article, "mcp") ||
    pathContains(article, "claude") ||
    article.tags.some((tag) => tag.toLowerCase().includes("mcp"))
  );
}

function isFastmailArticle(article: ArticleSummary): boolean {
  return pathContains(article, "fastmail");
}

export function selectLatestArticles(
  articles: ArticleSummary[],
  count: number,
): ArticleSummary[] {
  return [...articles].sort(byRecency).slice(0, count);
}

export function selectHomepageLatestArticles(
  articles: ArticleSummary[],
  count: number,
): ArticleSummary[] {
  const eligible = articles.filter(
    (article) => !isCompareArticle(article) && !isMcpFunnelArticle(article),
  );
  const latest = selectLatestArticles(eligible, count);

  if (latest.some(isFastmailArticle)) {
    return latest;
  }

  const [newestFastmail] = selectLatestArticles(
    eligible.filter(isFastmailArticle),
    1,
  );
  if (!newestFastmail) {
    return latest;
  }

  return [...latest.slice(0, -1), newestFastmail];
}

export function selectRelatedArticles(
  currentPath: string,
  articles: ArticleSummary[],
  count = RELATED_ARTICLE_COUNT,
): ArticleSummary[] {
  const currentTags = articles.find((article) => article.path === currentPath)?.tags ?? [];

  return articles
    .filter((article) => article.path !== currentPath)
    .sort((article, other) => {
      const sharedTagDifference =
        countSharedTags(other.tags, currentTags) - countSharedTags(article.tags, currentTags);
      return sharedTagDifference !== 0 ? sharedTagDifference : byRecency(article, other);
    })
    .slice(0, count);
}
