export interface ArticleSummary {
  blurb: string;
  createdAt: string;
  path: string;
  tags: string[];
  title: string;
}

const RELATED_ARTICLE_COUNT = 3;

function countSharedTags(tags: string[], otherTags: string[]): number {
  return tags.filter((tag) => otherTags.includes(tag)).length;
}

function byRecency(article: ArticleSummary, other: ArticleSummary): number {
  return other.createdAt.localeCompare(article.createdAt);
}

export function selectLatestArticles(
  articles: ArticleSummary[],
  count: number,
): ArticleSummary[] {
  return [...articles].sort(byRecency).slice(0, count);
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
