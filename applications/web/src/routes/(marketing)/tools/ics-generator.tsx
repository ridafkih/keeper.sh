import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Heading1, Heading2, Heading3 } from "@/components/ui/primitives/heading";
import { Text } from "@/components/ui/primitives/text";
import { Button, ButtonIcon, ButtonText } from "@/components/ui/primitives/button";
import { Input } from "@/components/ui/primitives/input";
import { Checkbox } from "@/components/ui/primitives/checkbox";
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
import {
  buildIcsCalendar,
  icsFileName,
  validateIcsEventDraft,
  type IcsEventDraft,
} from "@/utils/ics";
import { canonicalUrl, jsonLdScript, seoMeta, webPageSchema, breadcrumbSchema, breadcrumbTrail, faqSchema } from "@/lib/seo";
import { marketingCopy } from "@/lib/marketing-copy";
import DownloadIcon from "lucide-react/dist/esm/icons/download";
import CopyIcon from "lucide-react/dist/esm/icons/copy";

const breadcrumbs = breadcrumbTrail({ name: "ICS File Generator", path: "/tools/ics-generator" });

const icsGenerator = marketingCopy.icsGenerator;
const PAGE_DESCRIPTION = icsGenerator.seo.description;

const COPIED_RESET_DELAY = 2000;
const OBJECT_URL_RELEASE_DELAY = 1000;

const EMPTY_DRAFT: IcsEventDraft = {
  summary: "",
  description: "",
  location: "",
  allDay: false,
  start: "",
  end: "",
};

const FAQ_ITEMS = icsGenerator.faq.items;

export const Route = createFileRoute("/(marketing)/tools/ics-generator")({
  component: IcsGeneratorPage,
  head: () => ({
    links: [{ rel: "canonical", href: canonicalUrl("/tools/ics-generator") }],
    meta: seoMeta({
      title: icsGenerator.seo.title,
      description: PAGE_DESCRIPTION,
      path: "/tools/ics-generator",
    }),
    scripts: [
      jsonLdScript(webPageSchema(icsGenerator.seo.title, PAGE_DESCRIPTION, "/tools/ics-generator")),
      jsonLdScript(breadcrumbSchema(breadcrumbs)),
      jsonLdScript(faqSchema("/tools/ics-generator", FAQ_ITEMS)),
    ],
  }),
});

interface GeneratedFile {
  text: string;
  name: string;
}

function IcsGeneratorPage() {
  const [draft, setDraft] = useState<IcsEventDraft>(EMPTY_DRAFT);
  const [errors, setErrors] = useState<string[]>([]);
  const [generated, setGenerated] = useState<GeneratedFile | null>(null);
  const [copied, setCopied] = useState(false);

  const updateDraft = (patch: Partial<IcsEventDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setGenerated(null);
    setErrors([]);
    setCopied(false);
  };

  const handleAllDayChange = (allDay: boolean) => {
    updateDraft({ allDay, start: "", end: "" });
  };

  const handleGenerate = () => {
    const draftErrors = validateIcsEventDraft(draft);
    setErrors(draftErrors);

    if (draftErrors.length > 0) {
      setGenerated(null);
      return;
    }

    setGenerated({
      text: buildIcsCalendar(draft, {
        uid: `${crypto.randomUUID()}@keeper.sh`,
        stamp: new Date(),
      }),
      name: icsFileName(draft.summary),
    });
  };

  const handleCopy = async () => {
    if (!generated) return;
    await navigator.clipboard.writeText(generated.text);
    setCopied(true);
    setTimeout(() => setCopied(false), COPIED_RESET_DELAY);
  };

  const handleDownload = () => {
    if (!generated) return;
    const url = URL.createObjectURL(new Blob([generated.text], { type: "text/calendar" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = generated.name;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), OBJECT_URL_RELEASE_DELAY);
  };

  return (
    <div className="flex flex-col gap-6 py-16">
      <Breadcrumb items={breadcrumbs} />
      <header className="flex flex-col gap-1.5">
        <Heading1>{icsGenerator.header.heading}</Heading1>
        <Text size="base" tone="muted" className="max-w-[64ch] leading-6">
          {PAGE_DESCRIPTION}
        </Text>
      </header>

      <MarketingToolSection>
        <MarketingToolGrid>
          <MarketingToolPanel>
            <Heading3 as="h2">The event</Heading3>

            <MarketingToolField htmlFor="ics-summary" label="Title">
              <Input
                id="ics-summary"
                value={draft.summary}
                onChange={(event) => updateDraft({ summary: event.target.value })}
                placeholder="Quarterly planning"
              />
            </MarketingToolField>

            <Checkbox checked={draft.allDay} onCheckedChange={handleAllDayChange}>
              All-day event
            </Checkbox>

            <MarketingToolField
              htmlFor="ics-start"
              label={draft.allDay ? "First day" : "Starts"}
            >
              <Input
                id="ics-start"
                type={draft.allDay ? "date" : "datetime-local"}
                value={draft.start}
                onChange={(event) => updateDraft({ start: event.target.value })}
              />
            </MarketingToolField>

            <MarketingToolField
              htmlFor="ics-end"
              label={draft.allDay ? "Last day" : "Ends"}
              hint={draft.allDay ? "The last day the event covers. It is written out as the exclusive end date the format expects." : undefined}
            >
              <Input
                id="ics-end"
                type={draft.allDay ? "date" : "datetime-local"}
                value={draft.end}
                onChange={(event) => updateDraft({ end: event.target.value })}
              />
            </MarketingToolField>

            <MarketingToolField htmlFor="ics-location" label="Location">
              <Input
                id="ics-location"
                value={draft.location}
                onChange={(event) => updateDraft({ location: event.target.value })}
                placeholder="Meeting room, or a link"
              />
            </MarketingToolField>

            <MarketingToolField htmlFor="ics-description" label="Description">
              <textarea
                id="ics-description"
                value={draft.description}
                onChange={(event) => updateDraft({ description: event.target.value })}
                rows={4}
                placeholder="Agenda, dial-in details, anything else."
                className="w-full rounded-xl border border-interactive-border bg-background px-4 py-2.5 text-foreground tracking-tight placeholder:text-foreground-muted resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </MarketingToolField>

            {errors.length > 0 && (
              <ul className="flex flex-col gap-1 list-none">
                {errors.map((error) => (
                  <li key={error}>
                    <Text size="sm" tone="danger">{error}</Text>
                  </li>
                ))}
              </ul>
            )}

            <Button className="w-full justify-center" onClick={handleGenerate}>
              <ButtonText>Generate ICS File</ButtonText>
            </Button>
          </MarketingToolPanel>

          <MarketingToolPanel>
            <Heading3 as="h2">The file</Heading3>
            {generated
              ? (
                <>
                  <pre className="max-h-96 overflow-auto rounded-xl border border-interactive-border bg-background p-4 text-xs text-foreground whitespace-pre-wrap break-all">
                    {generated.text}
                  </pre>
                  <MarketingToolActions>
                    <Button size="compact" onClick={handleDownload}>
                      <ButtonIcon>
                        <DownloadIcon size={16} />
                      </ButtonIcon>
                      <ButtonText>Download {generated.name}</ButtonText>
                    </Button>
                    <Button size="compact" variant="border" onClick={handleCopy}>
                      <ButtonIcon>
                        <CopyIcon size={16} />
                      </ButtonIcon>
                      <ButtonText>{copied ? "Copied" : "Copy"}</ButtonText>
                    </Button>
                  </MarketingToolActions>
                </>
              )
              : (
                <Text size="sm">
                  Fill in the event and the .ics file appears here, ready to download or copy.
                </Text>
              )}
            <Text size="sm">
              Already have a file and want to read what is inside it? Use the{" "}
              <TextLink to="/tools/ics-viewer" align="left" size="sm">ICS file viewer</TextLink>.
            </Text>
          </MarketingToolPanel>
        </MarketingToolGrid>
      </MarketingToolSection>

      <MarketingToolSection>
        <Heading2>{icsGenerator.writes.heading}</Heading2>
        <Text size="sm" tone="muted" className="mt-2 max-w-[64ch]">
          {icsGenerator.writes.body}
        </Text>
      </MarketingToolSection>

      <MarketingFaqSection>
        <Heading2 className="text-center">{icsGenerator.faq.heading}</Heading2>
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
        title={icsGenerator.cta.title}
        body={icsGenerator.cta.body}
        source="ics-generator"
      />
    </div>
  );
}
