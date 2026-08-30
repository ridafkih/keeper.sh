export interface ArticleSummary {
  blurb: string;
  createdAt: string;
  homepage?: boolean;
  homepagePin?: boolean;
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

function isCompareArticle(article: ArticleSummary): boolean {
  return article.path.startsWith(COMPARE_PATH_PREFIX);
}

function isHomepageEligible(article: ArticleSummary): boolean {
  return !isCompareArticle(article) && article.homepage !== false;
}

function isHomepagePinned(article: ArticleSummary): boolean {
  return article.homepagePin === true;
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
  const eligible = articles.filter(isHomepageEligible);
  const pinned = eligible.filter(isHomepagePinned);

  if (pinned.length >= count) {
    return selectLatestArticles(pinned, count);
  }

  const latest = selectLatestArticles(eligible, count);
  const latestPaths = new Set(latest.map((article) => article.path));
  const pinsToInsert = selectLatestArticles(
    pinned.filter((article) => !latestPaths.has(article.path)),
    count,
  );

  if (pinsToInsert.length === 0) {
    return latest;
  }

  const unpinnedIndexes = latest.flatMap((article, index) =>
    isHomepagePinned(article) ? [] : [index],
  );
  const dropIndexes = new Set(unpinnedIndexes.slice(-pinsToInsert.length));

  return [
    ...latest.flatMap((article, index) => (dropIndexes.has(index) ? [] : [article])),
    ...pinsToInsert,
  ];
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
