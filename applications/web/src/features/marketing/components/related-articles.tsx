import { Link } from "@tanstack/react-router";
import { Heading3 } from "@/components/ui/primitives/heading";
import { Text } from "@/components/ui/primitives/text";
import type { ArticleSummary } from "@/lib/related-articles";

const RELATED_ARTICLES_HEADING_ID = "related-articles";

export function RelatedArticles({ articles }: { articles: ArticleSummary[] }) {
  if (articles.length === 0) return null;

  return (
    <aside aria-labelledby={RELATED_ARTICLES_HEADING_ID} className="flex flex-col gap-3">
      <Heading3 as="h2" id={RELATED_ARTICLES_HEADING_ID}>
        Related pages
      </Heading3>
      <ul className="flex flex-col gap-2 list-none">
        {articles.map((article) => (
          <li key={article.path}>
            <Link
              className="group block rounded-2xl border border-interactive-border bg-background p-4 shadow-xs transition-colors hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              to={article.path}
            >
              <Text size="sm" tone="default" className="group-hover:text-foreground-hover">
                {article.title}
              </Text>
              <Text size="sm" tone="muted" className="line-clamp-2">
                {article.blurb}
              </Text>
            </Link>
          </li>
        ))}
      </ul>
    </aside>
  );
}
