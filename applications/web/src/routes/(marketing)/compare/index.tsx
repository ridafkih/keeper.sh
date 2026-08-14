import { createFileRoute } from "@tanstack/react-router";
import { Heading1 } from "@/components/ui/primitives/heading";
import { Text } from "@/components/ui/primitives/text";
import { TextLink } from "@/components/ui/primitives/text-link";
import { ArticleCard } from "@/features/marketing/components/article-card";
import { ArticleCta } from "@/features/marketing/components/article-cta";
import { comparePages } from "@/lib/compare-pages";
import { canonicalUrl, jsonLdScript, seoMeta, breadcrumbSchema, breadcrumbTrail, collectionPageSchema } from "@/lib/seo";
import { Breadcrumb } from "@/components/ui/primitives/breadcrumb";

const breadcrumbs = breadcrumbTrail({ name: "Compare", path: "/compare" });

const PAGE_DESCRIPTION =
  "How Keeper.sh compares to the other calendar sync tools: which calendars each one connects, how fast changes land, what each costs, and who each one suits.";

export const Route = createFileRoute("/(marketing)/compare/")({
  component: CompareDirectoryPage,
  head: () => ({
    links: [{ rel: "canonical", href: canonicalUrl("/compare") }],
    meta: seoMeta({
      title: "Compare Keeper.sh With Other Calendar Sync Tools",
      description: PAGE_DESCRIPTION,
      path: "/compare",
    }),
    scripts: [
      jsonLdScript(breadcrumbSchema(breadcrumbs)),
      jsonLdScript(collectionPageSchema("/compare", "Compare", comparePages)),
    ],
  }),
});

function CompareDirectoryPage() {
  return (
    <div className="flex flex-col gap-8 py-16">
      <Breadcrumb items={breadcrumbs} />
      <header className="flex flex-col gap-1.5">
        <Heading1>Compare</Heading1>
        <Text size="base" tone="muted" className="leading-6">
          {PAGE_DESCRIPTION} Every figure links back to the source it came from. For the
          longer guides on syncing calendars, read the{" "}
          <TextLink align="left" size="base" to="/blog">blog</TextLink>.
        </Text>
      </header>

      <div className="flex flex-col gap-3">
        {comparePages.map((comparePage) => (
          <ArticleCard
            key={comparePage.slug}
            blurb={comparePage.metadata.blurb}
            createdAt={comparePage.metadata.createdAt}
            path={`/compare/${comparePage.slug}`}
            title={comparePage.metadata.title}
          />
        ))}
      </div>

      <ArticleCta />
    </div>
  );
}
