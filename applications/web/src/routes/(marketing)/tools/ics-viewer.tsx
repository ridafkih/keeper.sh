import { useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Heading1, Heading2, Heading3 } from "@/components/ui/primitives/heading";
import { Text } from "@/components/ui/primitives/text";
import { Button, ButtonIcon, ButtonText } from "@/components/ui/primitives/button";
import { Collapsible } from "@/components/ui/primitives/collapsible";
import { TextLink } from "@/components/ui/primitives/text-link";
import { Breadcrumb } from "@/components/ui/primitives/breadcrumb";
import {
  MarketingFaqItem,
  MarketingFaqList,
  MarketingFaqQuestion,
  MarketingFaqSection,
} from "@/features/marketing/components/marketing-faq";
import {
  MarketingToolActions,
  MarketingToolCta,
  MarketingToolField,
  MarketingToolGrid,
  MarketingToolPanel,
  MarketingToolSection,
} from "@/features/marketing/components/marketing-tool";
import { formatIcsDateValue, parseIcsFile, type ParsedIcsEvent } from "@/utils/ics";
import { pluralize } from "@/lib/pluralize";
import { canonicalUrl, jsonLdScript, seoMeta, webPageSchema, breadcrumbSchema, breadcrumbTrail, faqSchema } from "@/lib/seo";
import UploadIcon from "lucide-react/dist/esm/icons/upload";

const breadcrumbs = breadcrumbTrail({ name: "ICS File Viewer", path: "/tools/ics-viewer" });

const PAGE_DESCRIPTION =
  "Free ICS file viewer. Open a .ics file and read its events as plain dates, times, and details. It runs in your browser, so the file never leaves your machine.";

const FAQ_ITEMS = [
  {
    question: "What is inside an ICS file?",
    answer: "Plain text in the calendar file format defined by RFC 5545. Inside is a VCALENDAR block holding VEVENT entries, each with properties such as UID, DTSTART, DTEND, SUMMARY, LOCATION, and DESCRIPTION. This viewer reads those properties and lays them out in a readable form.",
  },
  {
    question: "Is my file uploaded?",
    answer: "No. The file is read and parsed in your browser, so its contents are never sent to Keeper.sh or anywhere else. No account is needed to use it.",
  },
  {
    question: "Why does a time show a time zone name instead of a converted time?",
    answer: "Times written with a TZID parameter, or with no zone at all, are shown exactly as the file records them along with the zone it names. Times written in UTC are converted to your computer's time zone.",
  },
  {
    question: "Can I open a subscription link here?",
    answer: "Download the file the link gives you and open that, or paste its contents into the box. Keeper.sh itself can subscribe to a calendar link and keep copying from it.",
  },
  {
    question: "Does it show repeating events?",
    answer: "Yes. It shows the RRULE line exactly as the file writes it, so you can read the repeat rule itself. It does not list each occurrence separately.",
  },
];

export const Route = createFileRoute("/(marketing)/tools/ics-viewer")({
  component: IcsViewerPage,
  head: () => ({
    links: [{ rel: "canonical", href: canonicalUrl("/tools/ics-viewer") }],
    meta: seoMeta({
      title: "ICS File Viewer",
      description: PAGE_DESCRIPTION,
      path: "/tools/ics-viewer",
    }),
    scripts: [
      jsonLdScript(webPageSchema("ICS File Viewer", PAGE_DESCRIPTION, "/tools/ics-viewer")),
      jsonLdScript(breadcrumbSchema(breadcrumbs)),
      jsonLdScript(faqSchema("/tools/ics-viewer", FAQ_ITEMS)),
    ],
  }),
});

function EventDetail({ label, children }: { label: string; children: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <Text size="xs" tone="muted">{label}</Text>
      <Text size="sm" tone="default" className="whitespace-pre-wrap break-words">{children}</Text>
    </div>
  );
}

function EventCard({ event }: { event: ParsedIcsEvent }) {
  return (
    <article className="flex flex-col gap-3 rounded-xl border border-interactive-border bg-background p-4">
      <Heading3 as="h3">{event.summary || "Untitled event"}</Heading3>
      {event.start && <EventDetail label="Starts">{formatIcsDateValue(event.start)}</EventDetail>}
      {event.end && (
        <EventDetail label="Ends">{formatIcsDateValue(event.end, { exclusiveEnd: true })}</EventDetail>
      )}
      {event.location && <EventDetail label="Location">{event.location}</EventDetail>}
      {event.organizer && <EventDetail label="Organizer">{event.organizer}</EventDetail>}
      {event.status && <EventDetail label="Status">{event.status}</EventDetail>}
      {event.recurrenceRule && <EventDetail label="Repeats">{event.recurrenceRule}</EventDetail>}
      {event.description && <EventDetail label="Description">{event.description}</EventDetail>}
      {event.uid && <EventDetail label="UID">{event.uid}</EventDetail>}
    </article>
  );
}

function IcsViewerPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);

  const parsed = useMemo(() => (text.trim() ? parseIcsFile(text) : null), [text]);

  const handleFileChange = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setFileName(file.name);
    setText(await file.text());
  };

  const handleClear = () => {
    setText("");
    setFileName(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <div className="flex flex-col gap-6 py-16">
      <Breadcrumb items={breadcrumbs} />
      <header className="flex flex-col gap-1.5">
        <Heading1>ICS file viewer</Heading1>
        <Text size="base" tone="muted" className="max-w-[64ch] leading-6">
          {PAGE_DESCRIPTION}
        </Text>
      </header>

      <MarketingToolSection>
        <MarketingToolGrid>
          <MarketingToolPanel>
            <Heading3 as="h2">The file</Heading3>
            <MarketingToolActions>
              <input
                ref={fileInputRef}
                type="file"
                accept=".ics,text/calendar"
                className="sr-only"
                onChange={(event) => handleFileChange(event.target.files)}
              />
              <Button size="compact" onClick={() => fileInputRef.current?.click()}>
                <ButtonIcon>
                  <UploadIcon size={16} />
                </ButtonIcon>
                <ButtonText>Choose an ICS File</ButtonText>
              </Button>
              {text && (
                <Button size="compact" variant="border" onClick={handleClear}>
                  <ButtonText>Clear</ButtonText>
                </Button>
              )}
            </MarketingToolActions>
            <MarketingToolField
              htmlFor="ics-source"
              label="Or paste the file contents"
              hint={fileName ? `Loaded from ${fileName}.` : undefined}
            >
              <textarea
                id="ics-source"
                value={text}
                onChange={(event) => setText(event.target.value)}
                rows={14}
                placeholder="BEGIN:VCALENDAR&#10;VERSION:2.0&#10;..."
                className="w-full rounded-xl border border-interactive-border bg-background px-4 py-2.5 text-foreground font-mono text-xs tracking-tight placeholder:text-foreground-muted resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </MarketingToolField>
          </MarketingToolPanel>

          <MarketingToolPanel>
            <Heading3 as="h2">What is in it</Heading3>
            {!parsed && (
              <Text size="sm">
                Choose a file or paste its contents, and the events it holds are listed here.
              </Text>
            )}
            {parsed?.errors.map((error) => (
              <Text key={error} size="sm" tone="danger">{error}</Text>
            ))}
            {parsed && parsed.errors.length === 0 && (
              <Text size="sm">
                {pluralize(parsed.events.length, "event")}
                {parsed.calendarName ? ` in ${parsed.calendarName}` : ""}
                {parsed.productId ? `, written by ${parsed.productId}` : ""}.
              </Text>
            )}
            {parsed && parsed.events.length > 0 && (
              <div className="flex flex-col gap-3 max-h-[40rem] overflow-auto">
                {parsed.events.map((event, index) => (
                  <EventCard key={event.uid ?? `event-${index}`} event={event} />
                ))}
              </div>
            )}
            <Text size="sm">
              Need to make a file instead of read one? Use the{" "}
              <TextLink to="/tools/ics-generator" align="left" size="sm">ICS file generator</TextLink>.
            </Text>
          </MarketingToolPanel>
        </MarketingToolGrid>
      </MarketingToolSection>

      <MarketingToolSection>
        <Heading2>How the file is read</Heading2>
        <Text size="sm" tone="muted" className="mt-2 max-w-[64ch]">
          Folded lines are joined back together and escaped text is restored. Each VEVENT is then read for its UID,
          start and end, title, location, organizer, status, repeat rule, and description. Your file is never changed.
        </Text>
      </MarketingToolSection>

      <MarketingFaqSection>
        <Heading2 className="text-center">Frequently Asked Questions</Heading2>
        <MarketingFaqList>
          {FAQ_ITEMS.map((item) => (
            <MarketingFaqItem key={item.question}>
              <Collapsible
                trigger={<MarketingFaqQuestion>{item.question}</MarketingFaqQuestion>}
              >
                <Text size="sm" tone="muted">{item.answer}</Text>
              </Collapsible>
            </MarketingFaqItem>
          ))}
        </MarketingFaqList>
      </MarketingFaqSection>

      <MarketingToolCta
        title="Reading calendar files to find a conflict?"
        body="Keeper.sh copies your events between Google Calendar, Outlook, iCloud, Fastmail and any CalDAV server, so a clash shows up in the calendar itself."
        source="ics-viewer"
      />
    </div>
  );
}
