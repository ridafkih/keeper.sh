/**
 * Lays out the /compare hub from the groups in the marketing collection.
 * A group names its articles by path; each one that is published is shown with
 * that page's blurb, and a group left with none is dropped. Compare pages that
 * no group names are returned as `ungrouped`, so a new page still reaches the hub
 * before the copy lists it.
 */
export interface CompareHubArticle {
  path: string;
  title: string;
  blurb: string;
}

export interface CompareHubGroup {
  heading: string;
  articles: CompareHubArticle[];
}

interface GroupCopy {
  heading: string;
  links: ReadonlyArray<{ label: string; path: string }>;
}

interface PublishedPage {
  slug: string;
  metadata: { title: string; blurb: string };
}

type Collections = Record<string, readonly PublishedPage[]>;

export function resolveCompareHubGroups(
  groups: readonly GroupCopy[],
  collections: Collections & { compare: readonly PublishedPage[] },
): { groups: CompareHubGroup[]; ungrouped: CompareHubArticle[] } {
  const publishedByPath = new Map<string, PublishedPage>(
    Object.entries(collections).flatMap(([collection, pages]) =>
      pages.map((page) => [`/${collection}/${page.slug}`, page] as const),
    ),
  );

  const resolvedGroups = groups
    .map((group) => ({
      heading: group.heading,
      articles: group.links.flatMap((link) => {
        const page = publishedByPath.get(link.path);
        return page ? [{ path: link.path, title: link.label, blurb: page.metadata.blurb }] : [];
      }),
    }))
    .filter((group) => group.articles.length > 0);

  const groupedPaths = new Set(resolvedGroups.flatMap((group) => group.articles.map((article) => article.path)));

  const ungrouped = collections.compare
    .map((page) => ({ path: `/compare/${page.slug}`, title: page.metadata.title, blurb: page.metadata.blurb }))
    .filter((article) => !groupedPaths.has(article.path));

  return { groups: resolvedGroups, ungrouped };
}
