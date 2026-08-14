import { createFileRoute, notFound } from "@tanstack/react-router";
import type { AllowedTags, Components } from "streamdown";
import { Heading1 } from "@/components/ui/primitives/heading";
import { Prose } from "@/components/ui/primitives/prose";
import { ExternalTextLink } from "@/components/ui/primitives/text-link";
import { Text } from "@/components/ui/primitives/text";
import { NotFoundState } from "@/components/ui/shells/not-found";
import { ArticleCta } from "@/features/marketing/components/article-cta";
import { MarkdownFaq, MarkdownFaqItem } from "@/features/marketing/components/markdown-faq";
import { RelatedArticles } from "@/features/marketing/components/related-articles";
import { articleLibrary } from "@/lib/article-library";
import { findComparePageBySlug } from "@/lib/compare-pages";
import { selectRelatedArticles } from "@/lib/related-articles";
import { formatIsoDate } from "@/utils/date";
import { canonicalUrl, jsonLdScript, seoMeta, blogPostingSchema, breadcrumbSchema, breadcrumbTrail, faqPageSchema } from "@/lib/seo";
import { Breadcrumb } from "@/components/ui/primitives/breadcrumb";

const MARKDOWN_FAQ_TAGS: AllowedTags = {
  faq: [],
  "faq-item": ["question"],
};

const MARKDOWN_FAQ_COMPONENTS = {
  faq: MarkdownFaq,
  "faq-item": MarkdownFaqItem,
} as Components;

const comparePageBreadcrumbs = (title: string, slug: string) =>
  breadcrumbTrail({ name: "Compare", path: "/compare" }, { name: title, path: `/compare/${slug}` });

export const Route = createFileRoute("/(marketing)/compare/$slug")({
  loader: ({ params }) => {
    if (!findComparePageBySlug(params.slug)) {
      throw notFound();
    }
  },
  component: ComparePage,
  notFoundComponent: NotFoundState,
  head: ({ params }) => {
    const comparePage = findComparePageBySlug(params.slug);
    if (!comparePage) {
      return {
        meta: [
          { title: "Compare · Keeper.sh" },
          { content: "noindex", name: "robots" },
        ],
      };
    }

    const pageUrl = `/compare/${params.slug}`;
    return {
      links: [{ rel: "canonical", href: canonicalUrl(pageUrl) }],
      meta: [
        ...seoMeta({
          title: comparePage.metadata.title,
          description: comparePage.metadata.description,
          path: pageUrl,
          type: "article",
          imagePath: comparePage.metadata.image,
        }),
        { content: comparePage.metadata.tags.join(", "), name: "keywords" },
        { content: comparePage.metadata.createdAt, property: "article:published_time" },
        { content: comparePage.metadata.updatedAt, property: "article:modified_time" },
        ...comparePage.metadata.tags.map((tag) => ({
          content: tag,
          property: "article:tag",
        })),
      ],
      scripts: [
        jsonLdScript(blogPostingSchema({
          title: comparePage.metadata.title,
          description: comparePage.metadata.description,
          path: pageUrl,
          createdAt: comparePage.metadata.createdAt,
          updatedAt: comparePage.metadata.updatedAt,
          tags: comparePage.metadata.tags,
          imagePath: comparePage.metadata.image,
        })),
        jsonLdScript(breadcrumbSchema(comparePageBreadcrumbs(comparePage.metadata.title, params.slug))),
        ...(comparePage.faq.length > 0
          ? [jsonLdScript(faqPageSchema(pageUrl, comparePage.faq))]
          : []),
      ],
    };
  },
});

function ComparePage() {
  const { slug } = Route.useParams();
  const comparePage = findComparePageBySlug(slug);
  if (!comparePage) {
    throw notFound();
  }

  const createdDate = formatIsoDate(comparePage.metadata.createdAt);
  const updatedDate = formatIsoDate(comparePage.metadata.updatedAt);
  const showUpdated = comparePage.metadata.updatedAt !== comparePage.metadata.createdAt;

  return (
    <div className="flex flex-col gap-6 py-16">
      <Breadcrumb items={comparePageBreadcrumbs(comparePage.metadata.title, slug)} />
      <header className="flex flex-col gap-2">
        <Heading1>{comparePage.metadata.title}</Heading1>
        <div className="flex flex-col">
          <Text size="sm" tone="muted" align="left">
            By{" "}
            <ExternalTextLink
              align="left"
              href="https://rida.dev"
              rel="noopener noreferrer"
              size="sm"
              target="_blank"
              tone="default"
            >
              Rida F&apos;kih
            </ExternalTextLink>
            {" · "}{createdDate}
            {showUpdated && <> · Updated {updatedDate}</>}
          </Text>
        </div>
      </header>

      <Prose allowedTags={MARKDOWN_FAQ_TAGS} components={MARKDOWN_FAQ_COMPONENTS}>
        {comparePage.content}
      </Prose>

      <RelatedArticles articles={selectRelatedArticles(`/compare/${slug}`, articleLibrary)} />

      <ArticleCta />
    </div>
  );
}
