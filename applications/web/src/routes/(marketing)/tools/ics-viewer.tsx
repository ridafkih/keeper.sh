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
import { marketingCopy } from "@/lib/marketing-copy";
import UploadIcon from "lucide-react/dist/esm/icons/upload";

const breadcrumbs = breadcrumbTrail({ name: "ICS File Viewer", path: "/tools/ics-viewer" });

const icsViewer = marketingCopy.icsViewer;
const PAGE_DESCRIPTION = icsViewer.seo.description;

const FAQ_ITEMS = icsViewer.faq.items;

export const Route = createFileRoute("/(marketing)/tools/ics-viewer")({
  component: IcsViewerPage,
  head: () => ({
    links: [{ rel: "canonical", href: canonicalUrl("/tools/ics-viewer") }],
    meta: seoMeta({
      title: icsViewer.seo.title,
      description: PAGE_DESCRIPTION,
      path: "/tools/ics-viewer",
    }),
    scripts: [
      jsonLdScript(webPageSchema(icsViewer.seo.title, PAGE_DESCRIPTION, "/tools/ics-viewer")),
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
        <Heading1>{icsViewer.header.heading}</Heading1>
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
        <Heading2>{icsViewer.howRead.heading}</Heading2>
        <Text size="sm" tone="muted" className="mt-2 max-w-[64ch]">
          {icsViewer.howRead.body}
        </Text>
      </MarketingToolSection>

      <MarketingFaqSection>
        <Heading2 className="text-center">{icsViewer.faq.heading}</Heading2>
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
        title={icsViewer.cta.title}
        body={icsViewer.cta.body}
        source="ics-viewer"
      />
    </div>
  );
}
