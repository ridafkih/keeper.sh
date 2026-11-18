import type { PropsWithChildren } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Heading1, Heading2, Heading3 } from "@/components/ui/primitives/heading";
import { Text } from "@/components/ui/primitives/text";
import { ExternalTextLink, TextLink } from "@/components/ui/primitives/text-link";
import { Breadcrumb } from "@/components/ui/primitives/breadcrumb";
import {
  MarkdownTable,
  MarkdownTableBody,
  MarkdownTableCell,
  MarkdownTableHeader,
  MarkdownTableRow,
  MarkdownTableSection,
} from "@/components/ui/primitives/markdown-components";
import { ArticleCta } from "@/features/marketing/components/article-cta";
import { resolveCompareHubGroups, type CompareHubArticle } from "@/features/marketing/compare-hub";
import { blogPosts } from "@/lib/blog-posts";
import { comparePages } from "@/lib/compare-pages";
import { marketingCopy } from "@/lib/marketing-copy";
import type { CompareCopy } from "@/lib/marketing-content";
import { jsonLdScript, seoHead, breadcrumbSchema, breadcrumbTrail, collectionPageSchema } from "@/lib/seo";

const PAGE_PATH = "/compare";

const compare = marketingCopy.compare;
const breadcrumbs = breadcrumbTrail({ name: compare.header.heading, path: PAGE_PATH });
const hub = resolveCompareHubGroups(compare.groups, { blog: blogPosts, compare: comparePages });

const SOURCE_LINK_CLASS_NAME = "max-w-full [overflow-wrap:anywhere]";

type SourcedFigure = CompareCopy["table"]["rows"][number]["price"];

export const Route = createFileRoute("/(marketing)/compare/")({
  component: CompareDirectoryPage,
  head: () => seoHead({
    title: compare.seo.title,
    description: compare.seo.description,
    path: PAGE_PATH,
    scripts: [
      jsonLdScript(breadcrumbSchema(breadcrumbs)),
      jsonLdScript(collectionPageSchema(PAGE_PATH, compare.header.heading, comparePages)),
    ],
  }),
});

function sourceLabel(href: string): string {
  return new URL(href).hostname.replace(/^www\./, "");
}

function FigureSource({ href }: { href: string }) {
  if (href.startsWith("/")) {
    return <TextLink to={href} size="xs" align="left" className={SOURCE_LINK_CLASS_NAME}>{`keeper.sh${href}`}</TextLink>;
  }

  return (
    <ExternalTextLink
      href={href}
      size="xs"
      align="left"
      className={SOURCE_LINK_CLASS_NAME}
      rel="noopener noreferrer"
      target="_blank"
    >
      {sourceLabel(href)}
    </ExternalTextLink>
  );
}

function FigureCell({ figure }: { figure: SourcedFigure }) {
  return (
    <MarkdownTableCell>
      <span className="flex flex-col items-start gap-1">
        <span>{figure.text}</span>
        <FigureSource href={figure.href} />
      </span>
    </MarkdownTableCell>
  );
}

function ToolName({ children, to }: PropsWithChildren<{ to: string | null }>) {
  if (!to) return children;

  return <TextLink to={to} size="sm" tone="default" align="left">{children}</TextLink>;
}

function ComparisonTable({ table }: { table: CompareCopy["table"] }) {
  return (
    <section className="flex flex-col gap-2">
      <Heading2>{table.heading}</Heading2>
      <Text size="sm" tone="muted" className="max-w-[64ch]">{table.lead}</Text>
      <MarkdownTable>
        <MarkdownTableSection>
          <MarkdownTableRow>
            <MarkdownTableHeader>{table.columns.tool}</MarkdownTableHeader>
            <MarkdownTableHeader>{table.columns.price}</MarkdownTableHeader>
            <MarkdownTableHeader>{table.columns.freePlan}</MarkdownTableHeader>
            <MarkdownTableHeader>{table.columns.calendars}</MarkdownTableHeader>
            <MarkdownTableHeader>{table.columns.speed}</MarkdownTableHeader>
          </MarkdownTableRow>
        </MarkdownTableSection>
        <MarkdownTableBody>
          {table.rows.map((row) => (
            <MarkdownTableRow key={row.tool}>
              <MarkdownTableCell>
                <span className="font-medium text-foreground">
                  <ToolName to={row.path}>{row.tool}</ToolName>
                </span>
              </MarkdownTableCell>
              <FigureCell figure={row.price} />
              <FigureCell figure={row.freePlan} />
              <FigureCell figure={row.calendars} />
              <FigureCell figure={row.speed} />
            </MarkdownTableRow>
          ))}
        </MarkdownTableBody>
      </MarkdownTable>
    </section>
  );
}

function ArticleList({ articles }: { articles: CompareHubArticle[] }) {
  return (
    <ul className="flex flex-col divide-y divide-interactive-border overflow-hidden rounded-2xl border border-interactive-border">
      {articles.map((article) => (
        <li key={article.path}>
          <Link
            to={article.path}
            className="group flex flex-col gap-1.5 bg-background p-4 transition-colors hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring md:p-6"
          >
            <Heading3 className="group-hover:text-foreground-hover">{article.title}</Heading3>
            <Text size="sm" tone="muted" className="line-clamp-3">{article.blurb}</Text>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function CompareDirectoryPage() {
  return (
    <div className="flex flex-col gap-10 py-16">
      <Breadcrumb items={breadcrumbs} />
      <header className="flex flex-col gap-3">
        <Heading1>{compare.header.heading}</Heading1>
        <Text size="base" tone="muted" className="max-w-[64ch] leading-6">{compare.header.definition}</Text>
        <Text size="base" tone="muted" className="max-w-[64ch] leading-6">{compare.header.entity}</Text>
        <Text size="base" tone="muted" className="max-w-[64ch] leading-6">
          {compare.header.guides.text}{" "}
          <TextLink align="left" size="base" tone="default" to={compare.header.guides.link.path}>
            {compare.header.guides.link.label}
          </TextLink>
        </Text>
      </header>

      {compare.table.rows.length > 0 && <ComparisonTable table={compare.table} />}

      {hub.groups.map((group) => (
        <section key={group.heading} className="flex flex-col gap-4">
          <Heading2>{group.heading}</Heading2>
          <ArticleList articles={group.articles} />
        </section>
      ))}

      {hub.ungrouped.length > 0 && <ArticleList articles={hub.ungrouped} />}

      <ArticleCta />
    </div>
  );
}
