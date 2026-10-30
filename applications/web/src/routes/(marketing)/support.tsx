import type { PropsWithChildren } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Heading1, Heading2, Heading3 } from "@/components/ui/primitives/heading";
import { Text } from "@/components/ui/primitives/text";
import { ExternalTextLink, TextLink } from "@/components/ui/primitives/text-link";
import { Breadcrumb } from "@/components/ui/primitives/breadcrumb";
import { jsonLdScript, seoHead, webPageSchema, breadcrumbSchema, breadcrumbTrail } from "@/lib/seo";
import { marketingCopy } from "@/lib/marketing-copy";

const breadcrumbs = breadcrumbTrail({ name: "Support", path: "/support" });

const SUPPORT_EMAIL = "support@keeper.sh";
const PRIVACY_EMAIL = "privacy@keeper.sh";
const INLINE_LINK_CLASS = "text-foreground underline underline-offset-2";
const ISSUES_URL = "https://github.com/ridafkih/keeper.sh/issues";

const support = marketingCopy.support;
const supportSections = support.sections;
const PAGE_DESCRIPTION = support.seo.description;

export const Route = createFileRoute("/(marketing)/support")({
  component: SupportPage,
  head: () => seoHead({
    title: support.seo.title,
    description: PAGE_DESCRIPTION,
    path: "/support",
    scripts: [
      jsonLdScript(webPageSchema(support.seo.schemaName, PAGE_DESCRIPTION, "/support")),
      jsonLdScript(breadcrumbSchema(breadcrumbs)),
    ],
  }),
});

function SupportPage() {
  return (
    <div className="flex flex-col gap-6 py-16">
      <Breadcrumb items={breadcrumbs} />
      <header className="flex flex-col gap-1.5">
        <Heading1>{support.header.heading}</Heading1>
        <Text size="base" tone="muted" className="max-w-[64ch] leading-6">
          {PAGE_DESCRIPTION}
        </Text>
      </header>

      <div className="flex flex-col gap-8">
        <Section title={supportSections.getHelp.title}>
          <Text size="sm">
            {supportSections.getHelp.emailLead} <MailLink address={SUPPORT_EMAIL} /> {supportSections.getHelp.afterEmail}
          </Text>
          <Text size="sm">
            {supportSections.getHelp.issuesLead}{" "}
            <ExternalTextLink align="left" href={ISSUES_URL} rel="noopener noreferrer" size="sm" target="_blank" tone="default">
              {supportSections.getHelp.issuesLinkLabel}
            </ExternalTextLink>
            {supportSections.getHelp.afterIssues}
          </Text>
        </Section>

        <Section title={supportSections.quickAnswers.title}>
          <Question title={supportSections.quickAnswers.updateTiming.question}>
            {supportSections.quickAnswers.updateTiming.answer}
          </Question>
          <Question title={supportSections.quickAnswers.missingEvent.question}>
            {supportSections.quickAnswers.missingEvent.lead}{" "}
            <Link className={INLINE_LINK_CLASS} params={{ slug: "event-has-not-arrived" }} to="/guides/$slug">
              {supportSections.quickAnswers.missingEvent.guideLinkLabel}
            </Link>
            {supportSections.quickAnswers.missingEvent.afterGuide}{" "}
            <TextLink align="left" size="sm" to="/guides" tone="default">{supportSections.quickAnswers.missingEvent.guidesLinkLabel}</TextLink>
            {" "}{supportSections.quickAnswers.missingEvent.end}
          </Question>
          <Question title={supportSections.quickAnswers.privacy.question}>
            {supportSections.quickAnswers.privacy.answer}
          </Question>
          <Question title={supportSections.quickAnswers.providers.question}>
            {supportSections.quickAnswers.providers.answer}
          </Question>
          <Text size="sm">
            {supportSections.quickAnswers.docsLead}{" "}
            <TextLink align="left" size="sm" to="/docs" tone="default">{supportSections.quickAnswers.docsLinkLabel}</TextLink>
            {" "}{supportSections.quickAnswers.afterDocs}
          </Text>
        </Section>

        <Section title={supportSections.plansBilling.title}>
          <Text size="sm">
            {supportSections.plansBilling.lead}{" "}
            <Link className={INLINE_LINK_CLASS} params={{ slug: "plans-and-limits" }} to="/docs/$slug">
              {supportSections.plansBilling.limitsLinkLabel}
            </Link>
            {" "}{supportSections.plansBilling.afterLimits}
          </Text>
          <Text size="sm">
            {supportSections.plansBilling.billing}
          </Text>
        </Section>

        <Section title={supportSections.accountData.title}>
          <Text size="sm">
            {supportSections.accountData.delete}
          </Text>
          <Text size="sm">
            {supportSections.accountData.exportLead} <MailLink address={PRIVACY_EMAIL} />{supportSections.accountData.afterEmail}{" "}
            <TextLink align="left" size="sm" to="/privacy" tone="default">{supportSections.accountData.privacyLinkLabel}</TextLink>
            {" "}{supportSections.accountData.afterPrivacy}{" "}
            <TextLink align="left" size="sm" to="/terms" tone="default">{supportSections.accountData.termsLinkLabel}</TextLink>
            {" "}{supportSections.accountData.end}
          </Text>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: PropsWithChildren<{ title: string }>) {
  return (
    <section className="flex flex-col gap-3">
      <Heading2 as="h2">{title}</Heading2>
      {children}
    </section>
  );
}

function Question({ title, children }: PropsWithChildren<{ title: string }>) {
  return (
    <div className="flex flex-col gap-1">
      <Heading3 as="h3">{title}</Heading3>
      <Text size="sm">{children}</Text>
    </div>
  );
}

function MailLink({ address }: { address: string }) {
  return (
    <a href={`mailto:${address}`} className={INLINE_LINK_CLASS}>
      {address}
    </a>
  );
}
