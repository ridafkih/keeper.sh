import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import ArrowLeft from "lucide-react/dist/esm/icons/arrow-left";
import ArrowRight from "lucide-react/dist/esm/icons/arrow-right";
import { Heading1 } from "@/components/ui/primitives/heading";
import { Text } from "@/components/ui/primitives/text";
import { TextLink } from "@/components/ui/primitives/text-link";
import { Breadcrumb } from "@/components/ui/primitives/breadcrumb";
import { NotFoundState } from "@/components/ui/shells/not-found";
import { ArticleCta } from "@/features/marketing/components/article-cta";
import { ChangelogNewTag } from "@/features/marketing/components/changelog-new-tag";
import {
  changelogFeatureNeighbours,
  changelogReleaseOf,
  findChangelogFeature,
  type ChangelogFeature,
} from "@/lib/changelog";
import { formatIsoDate } from "@/utils/date";
import {
  breadcrumbSchema,
  breadcrumbTrail,
  canonicalUrl,
  changelogEntrySchema,
  jsonLdScript,
  seoMeta,
} from "@/lib/seo";

/**
 * Matches the `TextLink` primitive, which cannot type a dynamic `to` alongside
 * its params. Underlined at rest, with a focus ring for anyone tabbing.
 */
const INLINE_LINK_CLASS =
  "text-sm tracking-tight underline underline-offset-2 rounded-sm text-foreground hover:text-foreground-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const NEIGHBOUR_LINK_CLASS =
  "group flex flex-col gap-1 rounded-2xl border border-interactive-border bg-background p-4 shadow-xs transition-colors hover:bg-background-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const entryBreadcrumbs = (title: string, slug: string) =>
  breadcrumbTrail({ name: "Changelog", path: "/changelog" }, { name: title, path: `/changelog/${slug}` });

export const Route = createFileRoute("/(marketing)/changelog/$slug")({
  loader: ({ params }) => {
    if (!findChangelogFeature(params.slug)) {
      throw notFound();
    }
  },
  component: ChangelogEntryPage,
  notFoundComponent: NotFoundState,
  head: ({ params }) => {
    const feature = findChangelogFeature(params.slug);
    const release = changelogReleaseOf(params.slug);
    if (!feature || !release) {
      return {
        meta: [
          { title: "Changelog · Keeper.sh" },
          { content: "noindex", name: "robots" },
        ],
      };
    }

    const path = `/changelog/${params.slug}`;
    return {
      links: [{ rel: "canonical", href: canonicalUrl(path) }],
      meta: [
        ...seoMeta({
          title: feature.title,
          description: feature.summary,
          path,
          type: "article",
        }),
        { content: release.date, property: "article:published_time" },
      ],
      scripts: [
        jsonLdScript(changelogEntrySchema({
          title: feature.title,
          description: feature.summary,
          slug: params.slug,
          date: release.date,
        })),
        jsonLdScript(breadcrumbSchema(entryBreadcrumbs(feature.title, params.slug))),
      ],
    };
  },
});

function NeighbourLink({
  direction,
  feature,
}: {
  direction: "newer" | "older";
  feature: ChangelogFeature;
}) {
  const Arrow = direction === "newer" ? ArrowLeft : ArrowRight;

  return (
    <Link className={NEIGHBOUR_LINK_CLASS} params={{ slug: feature.slug }} to="/changelog/$slug">
      <Text as="span" size="xs" tone="muted" className="flex items-center gap-1">
        {direction === "newer" && <Arrow aria-hidden="true" className="size-3.5" />}
        {direction === "newer" ? "Newer change" : "Older change"}
        {direction === "older" && <Arrow aria-hidden="true" className="size-3.5" />}
      </Text>
      <Text as="span" size="sm" tone="default" className="leading-6 group-hover:text-foreground-hover">
        {feature.title}
      </Text>
    </Link>
  );
}

function ChangelogEntryPage() {
  const { slug } = Route.useParams();
  const feature = findChangelogFeature(slug);
  const release = changelogReleaseOf(slug);
  if (!feature || !release) {
    throw notFound();
  }

  const { newer, older } = changelogFeatureNeighbours(slug);

  return (
    <div className="flex flex-col gap-10 py-16">
      <div className="flex flex-col gap-8">
        <Breadcrumb items={entryBreadcrumbs(feature.title, slug)} />
        <header className="flex flex-col items-start gap-3">
          <ChangelogNewTag />
          <Heading1>{feature.title}</Heading1>
          <Text size="sm" tone="muted">
            <time dateTime={release.date}>{formatIsoDate(release.date)}</time>
            {" · "}
            <Text as="span" size="sm" tone="disabled">
              {release.build}
            </Text>
          </Text>
        </header>
      </div>

      <div className="flex flex-col gap-4 max-w-[64ch]">
        <Text size="base" tone="default" className="leading-7">
          {feature.summary}
        </Text>
        {feature.body.map((paragraph) => (
          <Text key={paragraph} size="base" tone="muted" className="leading-7">
            {paragraph}
          </Text>
        ))}
        <Text size="sm" tone="muted" className="mt-2">
          Read more about{" "}
          {feature.link.to === "/blog/$slug" ? (
            <Link
              className={INLINE_LINK_CLASS}
              params={feature.link.params}
              to="/blog/$slug"
            >
              {feature.link.label}
            </Link>
          ) : (
            <TextLink align="left" size="sm" to={feature.link.to} tone="default">
              {feature.link.label}
            </TextLink>
          )}
          .
        </Text>
      </div>

      <nav
        aria-label="More changes"
        className="flex flex-col items-start gap-6 border-t border-interactive-border pt-8"
      >
        {(newer || older) && (
          <div className="grid w-full gap-3 sm:grid-cols-2">
            {newer ? <NeighbourLink direction="newer" feature={newer} /> : <div className="hidden sm:block" />}
            {older && <NeighbourLink direction="older" feature={older} />}
          </div>
        )}
        <TextLink align="left" size="sm" to="/changelog" tone="muted">
          All changes, newest first
        </TextLink>
      </nav>

      <ArticleCta />
    </div>
  );
}
