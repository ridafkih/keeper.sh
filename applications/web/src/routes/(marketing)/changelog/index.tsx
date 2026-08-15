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
import { changelogReleases, type ChangelogRelease } from "@/lib/changelog";
import { formatIsoDate } from "@/utils/date";
import {
  breadcrumbSchema,
  breadcrumbTrail,
  changelogCollectionSchema,
  jsonLdScript,
  seoHead,
} from "@/lib/seo";

const PAGE_HEADING = "What's new in Keeper.sh";

/** seoMeta appends the brand, so the tag reads "What's new · Keeper.sh". */
const PAGE_TITLE = "What's new";

const PAGE_DESCRIPTION =
  "Every change to Keeper.sh, newest first: new features, improvements, and the bugs we fixed.";

/**
 * Every row on the hub is this card, and every card goes to its release. The
 * title inside stays plain text: the card carries the hover, the focus ring and
 * the arrow, the way a blog card does.
 */
const ENTRY_CARD =
  "group block rounded-2xl border border-interactive-border bg-background p-5 shadow-xs transition-colors hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:p-6";

/**
 * A label for the list beneath it, not another line of that list: smaller than
 * its own items, in the plain foreground, and set in caps so the eye reads it
 * as a heading rather than as the first note.
 */
const NOTE_GROUP_LABEL = "font-medium uppercase tracking-wide";

const NOTE_KINDS = [
  { key: "features", label: "New" },
  { key: "improvements", label: "Improved" },
  { key: "fixes", label: "Fixed" },
] as const;

const breadcrumbs = breadcrumbTrail({ name: "Changelog", path: "/changelog" });

const collectionEntries = changelogReleases.map((release) => ({
  slug: release.slug,
  title: release.title,
}));

export const Route = createFileRoute("/(marketing)/changelog/")({
  component: ChangelogPage,
  head: () =>
    seoHead({
      title: PAGE_TITLE,
      description: PAGE_DESCRIPTION,
      path: "/changelog",
      scripts: [
        jsonLdScript(changelogCollectionSchema(PAGE_DESCRIPTION, collectionEntries)),
        jsonLdScript(breadcrumbSchema(breadcrumbs)),
      ],
    }),
});

function NoteList({ label, notes }: { label: string; notes: string[] }) {
  return (
    <section className="flex flex-col gap-2">
      <h3>
        <Text as="span" size="xs" tone="default" className={NOTE_GROUP_LABEL}>
          {label}
        </Text>
      </h3>
      <ul className="flex flex-col gap-2 list-none">
        {notes.map((note) => (
          <li key={note}>
            <Text size="sm" tone="muted" className="max-w-[64ch] leading-6">
              {note}
            </Text>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ReleaseCard({ release }: { release: ChangelogRelease }) {
  return (
    <Link className={ENTRY_CARD} params={{ slug: release.slug }} to="/changelog/$slug">
      <article className="flex flex-col gap-4">
        <div className="flex flex-col gap-3">
          <Heading2 as="h2" className="group-hover:text-foreground-hover">
            {release.title}
          </Heading2>
          <Text size="base" tone="default" className="max-w-[64ch] leading-7">
            {release.description}
          </Text>
        </div>

        {NOTE_KINDS.map(({ key, label }) =>
          release[key].length > 0 ? (
            <NoteList key={key} label={label} notes={release[key]} />
          ) : null,
        )}

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
        {changelogReleases.map((release) => (
          <TimelineEntry key={release.slug} aside="wide" className="scroll-mt-24" id={release.slug}>
            <TimelineAside>
              <Text as="p" size="sm" tone="default">
                <time dateTime={release.date}>{formatIsoDate(release.date)}</time>
              </Text>
              <Text size="xs" tone="disabled">
                {release.build}
              </Text>
            </TimelineAside>

            <TimelineContent>
              <ReleaseCard release={release} />
            </TimelineContent>
          </TimelineEntry>
        ))}
      </Timeline>
    </div>
  );
}
