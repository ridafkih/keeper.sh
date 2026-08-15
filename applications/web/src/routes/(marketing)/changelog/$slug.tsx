import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import ArrowLeft from "lucide-react/dist/esm/icons/arrow-left";
import ArrowRight from "lucide-react/dist/esm/icons/arrow-right";
import { Heading1, Heading2 } from "@/components/ui/primitives/heading";
import { Prose } from "@/components/ui/primitives/prose";
import { Text } from "@/components/ui/primitives/text";
import { TextLink } from "@/components/ui/primitives/text-link";
import { Breadcrumb } from "@/components/ui/primitives/breadcrumb";
import { NotFoundState } from "@/components/ui/shells/not-found";
import { ArticleCta } from "@/features/marketing/components/article-cta";
import {
  changelogReleaseNeighbours,
  findChangelogRelease,
  type ChangelogRelease,
} from "@/lib/changelog";
import { formatIsoDate } from "@/utils/date";
import {
  breadcrumbSchema,
  breadcrumbTrail,
  changelogEntrySchema,
  jsonLdScript,
  seoHead,
} from "@/lib/seo";

const NOTE_KINDS = [
  { key: "features", label: "New" },
  { key: "improvements", label: "Improved" },
  { key: "fixes", label: "Fixed" },
] as const;

const NEIGHBOUR_LINK_CLASS =
  "group flex flex-col gap-1 rounded-xl border border-interactive-border p-4 transition-colors hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function releaseBreadcrumbs(title: string, slug: string) {
  return breadcrumbTrail(
    { name: "Changelog", path: "/changelog" },
    { name: title, path: `/changelog/${slug}` },
  );
}

export const Route = createFileRoute("/(marketing)/changelog/$slug")({
  loader: ({ params }) => {
    if (!findChangelogRelease(params.slug)) {
      throw notFound();
    }
  },
  component: ChangelogReleasePage,
  notFoundComponent: NotFoundState,
  head: ({ params }) => {
    const release = findChangelogRelease(params.slug);

    if (!release) {
      return {};
    }

    const breadcrumbs = releaseBreadcrumbs(release.title, release.slug);

    return seoHead({
      title: release.title,
      description: release.description,
      path: `/changelog/${release.slug}`,
      type: "article",
      scripts: [
        jsonLdScript(
          changelogEntrySchema({
            title: release.title,
            description: release.description,
            slug: release.slug,
            date: release.date,
          }),
        ),
        jsonLdScript(breadcrumbSchema(breadcrumbs)),
      ],
    });
  },
});

function NeighbourLink({
  direction,
  release,
}: {
  direction: "newer" | "older";
  release: ChangelogRelease;
}) {
  const Arrow = direction === "newer" ? ArrowLeft : ArrowRight;

  return (
    <Link className={NEIGHBOUR_LINK_CLASS} params={{ slug: release.slug }} to="/changelog/$slug">
      <Text as="span" size="xs" tone="muted" className="flex items-center gap-1">
        {direction === "newer" && <Arrow aria-hidden="true" className="size-3.5" />}
        {direction === "newer" ? "Newer release" : "Older release"}
        {direction === "older" && <Arrow aria-hidden="true" className="size-3.5" />}
      </Text>
      <Text as="span" size="sm" tone="default" className="leading-6 group-hover:text-foreground-hover">
        {release.title}
      </Text>
    </Link>
  );
}

function NoteSection({ label, notes }: { label: string; notes: string[] }) {
  return (
    <section className="flex flex-col gap-3">
      <Heading2 as="h2">{label}</Heading2>
      <ul className="flex flex-col gap-2 list-none">
        {notes.map((note) => (
          <li key={note}>
            <Text size="base" tone="muted" className="max-w-[64ch] leading-7">
              {note}
            </Text>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ChangelogReleasePage() {
  const { slug } = Route.useParams();
  const release = findChangelogRelease(slug);

  if (!release) {
    throw notFound();
  }

  const { newer, older } = changelogReleaseNeighbours(slug);

  return (
    <div className="flex flex-col gap-10 py-16">
      <div className="flex flex-col gap-8">
        <Breadcrumb items={releaseBreadcrumbs(release.title, release.slug)} />
        <header className="flex flex-col items-start gap-3">
          <Heading1>{release.title}</Heading1>
          <Text size="sm" tone="muted">
            <time dateTime={release.date}>{formatIsoDate(release.date)}</time>
            {" · "}
            <Text as="span" size="sm" tone="disabled">
              {release.build}
            </Text>
          </Text>
        </header>
      </div>

      <Prose>{release.content}</Prose>

      {NOTE_KINDS.map(({ key, label }) =>
        release[key].length > 0 ? (
          <NoteSection key={key} label={label} notes={release[key]} />
        ) : null,
      )}

      <nav
        aria-label="More releases"
        className="flex flex-col items-start gap-6 border-t border-interactive-border pt-8"
      >
        {(newer || older) && (
          <div className="grid w-full gap-3 sm:grid-cols-2">
            {newer ? (
              <NeighbourLink direction="newer" release={newer} />
            ) : (
              <div className="hidden sm:block" />
            )}
            {older && <NeighbourLink direction="older" release={older} />}
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
