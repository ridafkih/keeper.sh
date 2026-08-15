import { createFileRoute, Link } from "@tanstack/react-router";
import { Collapsible } from "@/components/ui/primitives/collapsible";
import { Heading1, Heading2 } from "@/components/ui/primitives/heading";
import { Prose } from "@/components/ui/primitives/prose";
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
 * The entry is not one big link: the prose inside carries links of its own and an
 * anchor cannot nest, so the title is what links to the entry's page.
 */
const ENTRY_TITLE_LINK =
  "rounded-lg hover:text-foreground-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

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

function NoteDisclosure({ label, notes }: { label: string; notes: string[] }) {
  return (
    <Collapsible
      className="rounded-xl border border-interactive-border"
      trigger={
        <Text as="span" size="sm" tone="default" className="font-medium">
          {label}
          <Text as="span" size="sm" tone="muted">
            {` (${notes.length})`}
          </Text>
        </Text>
      }
    >
      <ul className="flex flex-col gap-2 list-disc pl-5 marker:text-foreground-muted">
        {notes.map((note) => (
          <li key={note}>
            <Text size="sm" tone="default" className="max-w-[64ch] leading-6">
              {note}
            </Text>
          </li>
        ))}
      </ul>
    </Collapsible>
  );
}

function EntryCard({ entry }: { entry: ChangelogRelease }) {
  const hasNotes = NOTE_KINDS.some(({ key }) => entry[key].length > 0);

  return (
    <article className="flex flex-col gap-4">
      <Heading2 as="h2">
        <Link className={ENTRY_TITLE_LINK} params={{ slug: entry.slug }} to="/changelog/$slug">
          {entry.title}
        </Link>
      </Heading2>

      <Prose>{entry.content}</Prose>

      {hasNotes && (
        <div className="flex flex-col gap-2">
          {NOTE_KINDS.map(({ key, label }) =>
            entry[key].length > 0 ? (
              <NoteDisclosure key={key} label={label} notes={entry[key]} />
            ) : null,
          )}
        </div>
      )}
    </article>
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
              <Text size="xs" tone="muted">
                {release.version}
              </Text>
            </TimelineAside>

            <TimelineContent>
              <EntryCard entry={release} />
            </TimelineContent>
          </TimelineEntry>
        ))}
      </Timeline>
    </div>
  );
}
