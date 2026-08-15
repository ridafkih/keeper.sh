import { createFileRoute, Link } from "@tanstack/react-router";
import ArrowRight from "lucide-react/dist/esm/icons/arrow-right";
import { Heading1, Heading2 } from "@/components/ui/primitives/heading";
import { Text } from "@/components/ui/primitives/text";
import { ExternalTextLink } from "@/components/ui/primitives/text-link";
import { Breadcrumb } from "@/components/ui/primitives/breadcrumb";
import {
  Timeline,
  TimelineAside,
  TimelineContent,
  TimelineEntry,
} from "@/components/ui/primitives/timeline";
import { ChangelogNewTag } from "@/features/marketing/components/changelog-new-tag";
import {
  changelogKindLabel,
  CHANGELOG_KINDS,
  type ChangelogKind,
} from "@/features/marketing/components/changelog-kinds";
import {
  changelogFeatures,
  changelogReleases,
  type ChangelogFeature,
  type ChangelogNote,
} from "@/lib/changelog";
import { formatIsoDate } from "@/utils/date";
import {
  breadcrumbSchema,
  breadcrumbTrail,
  canonicalUrl,
  changelogCollectionSchema,
  jsonLdScript,
  seoMeta,
} from "@/lib/seo";

const PAGE_HEADING = "What's new in Keeper.sh";

/** seoMeta appends the brand, so the tag reads "What's new · Keeper.sh". */
const PAGE_TITLE = "What's new";

const PAGE_DESCRIPTION =
  "Every change to Keeper.sh, newest first: new features, improvements, and the bugs we fixed.";

/**
 * The whole entry is the link, the way a blog card is: the title inside stays
 * plain text, and the card carries the hover, the focus ring and the arrow.
 * A heading with a link inside it is not a pattern this codebase has.
 */
const ENTRY_CARD =
  "group block rounded-2xl border border-interactive-border bg-background p-5 shadow-xs transition-colors hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:p-6";

/**
 * A label for the list beneath it, not another line of that list: smaller than
 * its own items, in the plain foreground, and set in caps so the eye reads it
 * as a heading rather than as the first note.
 */
const NOTE_GROUP_LABEL = "font-medium uppercase tracking-wide";

const breadcrumbs = breadcrumbTrail({ name: "Changelog", path: "/changelog" });

const collectionEntries = changelogFeatures.map((feature) => ({
  slug: feature.slug,
  title: feature.title,
}));

export const Route = createFileRoute("/(marketing)/changelog/")({
  component: ChangelogPage,
  head: () => ({
    links: [{ rel: "canonical", href: canonicalUrl("/changelog") }],
    meta: seoMeta({
      title: PAGE_TITLE,
      description: PAGE_DESCRIPTION,
      path: "/changelog",
    }),
    scripts: [
      jsonLdScript(changelogCollectionSchema(PAGE_DESCRIPTION, collectionEntries)),
      jsonLdScript(breadcrumbSchema(breadcrumbs)),
    ],
  }),
});

/**
 * One dated row of the index. Entries are the unit, so a date that covers three
 * of them appears three times: the repetition is what makes the column scan.
 */
interface ChangelogRow {
  key: string;
  date: string;
  build: string;
  /** Set on the first row of a release, which is where the feed's link lands. */
  releaseId?: string;
  content: ChangelogRowContent;
}

type ChangelogRowContent =
  | { kind: "feature"; feature: ChangelogFeature }
  | { kind: "notes"; noteKind: ChangelogKind; notes: ChangelogNote[] };

function changelogRows(): ChangelogRow[] {
  return changelogReleases.flatMap((release) => {
    const rows: ChangelogRow[] = release.features.map((feature) => ({
      key: feature.slug,
      date: release.date,
      build: release.build,
      content: { kind: "feature", feature },
    }));

    for (const noteKind of CHANGELOG_KINDS) {
      const notes = release[noteKind];
      if (notes.length > 0) {
        rows.push({
          key: `${release.date}-${noteKind}`,
          date: release.date,
          build: release.build,
          content: { kind: "notes", noteKind, notes },
        });
      }
    }

    const [first] = rows;
    if (first) {
      first.releaseId = `release-${release.date}`;
    }

    return rows;
  });
}

const rows = changelogRows();

/**
 * A featured entry carries the release: a real heading, the prose that explains
 * the change, and a link of its own. The notes beneath it are the flat
 * catch-all, one level down.
 */
function FeatureCard({ feature }: { feature: ChangelogFeature }) {
  return (
    <Link
      className={ENTRY_CARD}
      params={{ slug: feature.slug }}
      to="/changelog/$slug"
    >
      <article className="flex flex-col gap-3">
        <Heading2 as="h2" className="group-hover:text-foreground-hover">
          {feature.title}
        </Heading2>
        <Text size="base" tone="default" className="max-w-[64ch] leading-7">
          {feature.summary}
        </Text>
        {feature.body.map((paragraph) => (
          <Text key={paragraph} size="sm" tone="muted" className="max-w-[64ch] leading-6">
            {paragraph}
          </Text>
        ))}
        <Text as="span" size="sm" tone="default" className="mt-1 flex items-center gap-1">
          Read the full entry
          <ArrowRight
            aria-hidden="true"
            className="size-4 transition-transform group-hover:translate-x-0.5"
          />
        </Text>
      </article>
    </Link>
  );
}

/**
 * Long lists of fixes read as a wall in one column, so they wrap into two once
 * there is room. Short lists stay a single column, because two would leave a
 * hole beside them.
 */
function NoteGroup({ kind, notes }: { kind: ChangelogKind; notes: ChangelogNote[] }) {
  return (
    <section className="flex flex-col gap-3">
      <h3>
        <Text as="span" size="xs" tone="default" className={NOTE_GROUP_LABEL}>
          {changelogKindLabel[kind]}
        </Text>
      </h3>
      <ul
        className={`grid gap-x-8 gap-y-2 list-none ${notes.length > 4 ? "sm:grid-cols-2" : ""}`}
      >
        {notes.map((note) => (
          <li key={note.id} id={note.id} className="scroll-mt-24">
            <Text size="sm" tone="muted" className="max-w-[56ch] leading-6">
              <Text as="span" size="sm" tone="default" className="font-medium">
                {note.area}
              </Text>
              {" — "}
              {note.summary}
            </Text>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ChangelogPage() {
  return (
    <div className="flex flex-col gap-12 py-16">
      <div className="flex flex-col gap-8">
        <Breadcrumb items={breadcrumbs} />
        <header className="flex flex-col items-start gap-3">
          <Heading1>{PAGE_HEADING}</Heading1>
          <Text size="base" tone="muted" className="max-w-[64ch] leading-6">
            {PAGE_DESCRIPTION}
          </Text>
          <ExternalTextLink align="left" href="/changelog.xml" size="sm" tone="muted">
            Follow by RSS
          </ExternalTextLink>
        </header>
      </div>

      <Timeline>
        {rows.map((row) => (
          <TimelineEntry
            key={row.key}
            aside="wide"
            className="scroll-mt-24"
            id={row.releaseId}
          >
            <TimelineAside>
              <Text as="p" size="sm" tone="default">
                <time dateTime={row.date}>{formatIsoDate(row.date)}</time>
              </Text>
              <Text size="xs" tone="disabled">
                {row.build}
              </Text>
              {row.content.kind === "feature" && (
                <div className="mt-1">
                  <ChangelogNewTag />
                </div>
              )}
            </TimelineAside>

            <TimelineContent>
              {row.content.kind === "feature" ? (
                <div id={row.content.feature.slug} className="scroll-mt-24">
                  <FeatureCard feature={row.content.feature} />
                </div>
              ) : (
                <NoteGroup kind={row.content.noteKind} notes={row.content.notes} />
              )}
            </TimelineContent>
          </TimelineEntry>
        ))}
      </Timeline>
    </div>
  );
}
