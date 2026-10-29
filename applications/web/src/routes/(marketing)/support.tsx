import type { PropsWithChildren } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Heading1, Heading2, Heading3 } from "@/components/ui/primitives/heading";
import { Text } from "@/components/ui/primitives/text";
import { ExternalTextLink, TextLink } from "@/components/ui/primitives/text-link";
import { Breadcrumb } from "@/components/ui/primitives/breadcrumb";
import { jsonLdScript, seoHead, webPageSchema, breadcrumbSchema, breadcrumbTrail } from "@/lib/seo";

const breadcrumbs = breadcrumbTrail({ name: "Support", path: "/support" });

const SUPPORT_EMAIL = "support@keeper.sh";
const PRIVACY_EMAIL = "privacy@keeper.sh";
const INLINE_LINK_CLASS = "text-foreground underline underline-offset-2";
const ISSUES_URL = "https://github.com/ridafkih/keeper.sh/issues";

const PAGE_DESCRIPTION =
  "How to get help with Keeper.sh: who to email, where to report a bug, and answers on sync timing, plans, billing and deleting your account.";

export const Route = createFileRoute("/(marketing)/support")({
  component: SupportPage,
  head: () => seoHead({
    title: "Support",
    description: PAGE_DESCRIPTION,
    path: "/support",
    scripts: [
      jsonLdScript(webPageSchema("Keeper.sh support", PAGE_DESCRIPTION, "/support")),
      jsonLdScript(breadcrumbSchema(breadcrumbs)),
    ],
  }),
});

function SupportPage() {
  return (
    <div className="flex flex-col gap-6 py-16">
      <Breadcrumb items={breadcrumbs} />
      <header className="flex flex-col gap-1.5">
        <Heading1>Support</Heading1>
        <Text size="base" tone="muted" className="max-w-[64ch] leading-6">
          {PAGE_DESCRIPTION}
        </Text>
      </header>

      <div className="flex flex-col gap-8">
        <Section title="Get help">
          <Text size="sm">
            Email <MailLink address={SUPPORT_EMAIL} /> with your question. Include the email address on
            your Keeper.sh account and the calendars involved.
          </Text>
          <Text size="sm">
            File bugs and feature requests as{" "}
            <ExternalTextLink align="left" href={ISSUES_URL} rel="noopener noreferrer" size="sm" target="_blank" tone="default">
              issues on GitHub
            </ExternalTextLink>
            . They are triaged in public.
          </Text>
        </Section>

        <Section title="Quick answers">
          <Question title="How often do calendars update?">
            On Pro, Google and Outlook changes land within seconds through webhooks, and iCloud, Fastmail
            and other CalDAV calendars sync every minute. On Free, changes land every 30 minutes.
          </Question>
          <Question title="An event has not arrived in my other calendar">
            Work through{" "}
            <Link className={INLINE_LINK_CLASS} params={{ slug: "event-has-not-arrived" }} to="/guides/$slug">
              the missing event guide
            </Link>
            . The{" "}
            <TextLink align="left" size="sm" to="/guides" tone="default">guides</TextLink>
            {" "}cover the other common problems, each starting from what you can see.
          </Question>
          <Question title="Can my colleagues see what my personal events are?">
            No. A copy shows the name of the calendar it came from, with no title, description, location
            or guest list. Pro lets you pass the title, description and location through, and the guest
            list is never copied on any plan.
          </Question>
          <Question title="Which calendars does Keeper.sh work with?">
            Google Calendar, Outlook, iCloud and Fastmail sign in directly. Every other calendar connects
            with a CalDAV login or a calendar link.
          </Question>
          <Text size="sm">
            The{" "}
            <TextLink align="left" size="sm" to="/docs" tone="default">docs</TextLink>
            {" "}explain what every setting does.
          </Text>
        </Section>

        <Section title="Plans and billing">
          <Text size="sm">
            Free covers 2 linked accounts, 3 connections and 1 shareable link. Pro is unlimited on all
            three and costs $5 a month, or $45 a year. The{" "}
            <Link className={INLINE_LINK_CLASS} params={{ slug: "plans-and-limits" }} to="/docs/$slug">
              plans and limits
            </Link>
            {" "}page has the full comparison.
          </Text>
          <Text size="sm">
            Billing runs through Polar. To change or cancel your plan, open the dashboard and choose Manage
            Plan. After you cancel, you keep access until the period you paid for ends.
          </Text>
        </Section>

        <Section title="Your account and data">
          <Text size="sm">
            To delete your account, open Settings in the dashboard and choose Delete Account. We delete all
            associated data within 30 days.
          </Text>
          <Text size="sm">
            To access, correct or export your data, email <MailLink address={PRIVACY_EMAIL} />. The{" "}
            <TextLink align="left" size="sm" to="/privacy" tone="default">privacy policy</TextLink>
            {" "}covers what we collect and how long we keep it, and the{" "}
            <TextLink align="left" size="sm" to="/terms" tone="default">terms of service</TextLink>
            {" "}cover billing and acceptable use.
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
