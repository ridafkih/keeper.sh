import { notFound } from "@tanstack/react-router";
import type { AllowedTags, Components } from "streamdown";
import { Breadcrumb } from "@/components/ui/primitives/breadcrumb";
import { Heading1 } from "@/components/ui/primitives/heading";
import { Prose } from "@/components/ui/primitives/prose";
import { Text } from "@/components/ui/primitives/text";
import { ArticleCta } from "@/features/marketing/components/article-cta";
import { MarkdownFaq, MarkdownFaqItem } from "@/features/marketing/components/markdown-faq";
import { RelatedArticles } from "@/features/marketing/components/related-articles";
import { siloPageBreadcrumbs } from "@/lib/content-silo-head";
import { findSiloPageBySlug, siloArticleSummaries, type ContentSilo } from "@/lib/content-silos";
import { selectRelatedArticles } from "@/lib/related-articles";
import { formatIsoDate } from "@/utils/date";

const MARKDOWN_FAQ_TAGS: AllowedTags = {
  faq: [],
  "faq-item": ["question"],
};

const MARKDOWN_FAQ_COMPONENTS = {
  faq: MarkdownFaq,
  "faq-item": MarkdownFaqItem,
} as Components;

export function ContentSiloPage({ silo, slug }: { silo: ContentSilo; slug: string }) {
  const page = findSiloPageBySlug(silo, slug);
  if (!page) {
    throw notFound();
  }

  const pagePath = `${silo.basePath}/${slug}`;

  return (
    <div className="flex flex-col gap-6 py-16">
      <Breadcrumb items={siloPageBreadcrumbs(silo, page.metadata.title, slug)} />
      <header className="flex flex-col gap-2">
        <Heading1>{page.metadata.title}</Heading1>
        <Text size="sm" tone="muted" align="left">
          Updated {formatIsoDate(page.metadata.updatedAt)}
        </Text>
      </header>

      <Prose allowedTags={MARKDOWN_FAQ_TAGS} components={MARKDOWN_FAQ_COMPONENTS}>
        {page.content}
      </Prose>

      <RelatedArticles articles={selectRelatedArticles(pagePath, siloArticleSummaries(silo))} />

      <ArticleCta />
    </div>
  );
}
