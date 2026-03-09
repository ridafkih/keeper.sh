import type { PropsWithChildren } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Heading1, Heading2, Heading3 } from "../../components/ui/primitives/heading";
import { Text } from "../../components/ui/primitives/text";
import { CanonicalLink, JsonLd, seoMeta, webPageSchema, breadcrumbSchema } from "../../lib/seo";

export const Route = createFileRoute("/(marketing)/privacy")({
  component: PrivacyPage,
  head: () => ({
    meta: seoMeta({
      title: "Privacy Policy",
      description:
        "Privacy policy for Keeper.sh, the open-source calendar syncing service. Learn how we collect, use, and protect your data.",
      path: "/privacy",
    }),
  }),
});

function PrivacyPage() {
  return (
    <div className="flex flex-col gap-6 py-16">
      <CanonicalLink path="/privacy" />
      <JsonLd data={webPageSchema("Privacy Policy", "Privacy policy for Keeper.sh, the open-source calendar syncing service.", "/privacy")} />
      <JsonLd data={breadcrumbSchema([{ name: "Home", path: "/" }, { name: "Privacy Policy", path: "/privacy" }])} />
      <div className="flex flex-col gap-1">
        <Heading1>Privacy Policy</Heading1>
        <Text size="sm" tone="muted">Last updated: December 2025</Text>
      </div>
      <div className="flex flex-col gap-8">
        <Section title="Overview">
          <Text size="sm">
            Keeper.sh (&ldquo;we&rdquo;, &ldquo;our&rdquo;, or &ldquo;us&rdquo;) is committed to protecting your privacy. This Privacy Policy
            explains how we collect, use, disclose, and safeguard your information when you use our
            calendar synchronization service.
          </Text>
          <Text size="sm">
            By using Keeper.sh, you consent to the data practices described in this policy. If you do not
            agree with the terms of this policy, please do not access or use our service.
          </Text>
        </Section>

        <Section title="Information We Collect">
          <Heading3 as="h3">Account Information</Heading3>
          <Text size="sm">
            When you create an account, we collect your email address and authentication credentials.
            If you sign up using a third-party provider (such as Google), we receive basic profile
            information as permitted by your privacy settings with that provider.
          </Text>
          <Heading3 as="h3">Calendar Data</Heading3>
          <Text size="sm">
            To provide our service, we access calendar data from sources you connect. This includes
            event titles, times, durations, and associated metadata. We only access calendars you
            explicitly authorize.
          </Text>
          <Heading3 as="h3">Usage Data</Heading3>
          <Text size="sm">
            We automatically collect certain information when you access our service, including your
            IP address, browser type, operating system, access times, and pages viewed. This data
            helps us improve our service and diagnose technical issues.
          </Text>
        </Section>

        <Section title="How We Use Your Information">
          <Text size="sm">We use the information we collect to:</Text>
          <ul className="list-disc list-inside flex flex-col gap-1 ml-2 text-sm tracking-tight text-foreground-muted">
            <li>Provide, maintain, and improve our calendar syncing service</li>
            <li>Aggregate and anonymize calendar events for shared feeds, showing only busy/free status</li>
            <li>Push synchronized events to your designated destination calendars</li>
            <li>Send service-related communications and respond to inquiries</li>
            <li>Monitor and analyze usage patterns to improve user experience</li>
            <li>Detect, prevent, and address technical issues or abuse</li>
          </ul>
        </Section>

        <Section title="Data Anonymization">
          <Text size="sm">
            A core feature of Keeper.sh is event anonymization. When you generate a shared iCal feed or
            push to external calendars, event details (titles, descriptions, attendees, locations) are
            stripped. Only busy/free time blocks are shared, protecting the privacy of your schedule
            details.
          </Text>
        </Section>

        <Section title="Data Storage and Security">
          <Text size="sm">
            Your data is stored on secure servers with encryption at rest and in transit. We implement
            industry-standard security measures including access controls, monitoring, and regular
            security assessments.
          </Text>
          <Text size="sm">
            Calendar data is cached temporarily to enable synchronization and is refreshed according
            to your plan&apos;s sync interval. We do not retain historical calendar data beyond what is
            necessary for the service to function.
          </Text>
        </Section>

        <Section title="Data Retention">
          <Text size="sm">
            We retain your account information and calendar data for as long as your account is
            active. When you delete your account, we delete all associated data within 30 days, except
            where retention is required by law or for legitimate business purposes (such as fraud
            prevention).
          </Text>
        </Section>

        <Section title="Third-Party Services">
          <Text size="sm">
            We integrate with third-party calendar providers (such as Google Calendar) to access and
            sync your calendar data. These integrations are governed by the respective providers&apos;
            terms and privacy policies. We only request the minimum permissions necessary to provide
            our service.
          </Text>
          <Text size="sm">
            We use third-party services for payment processing (Polar). Payment information is handled
            directly by these processors and is not stored on our servers.
          </Text>
          <Text size="sm">
            We do not sell, trade, or otherwise transfer your personal information to third parties
            for marketing purposes.
          </Text>
        </Section>

        <Section title="Your Rights and Choices">
          <Text size="sm">You have the right to:</Text>
          <ul className="list-disc list-inside flex flex-col gap-1 ml-2 text-sm tracking-tight text-foreground-muted">
            <li>Access the personal data we hold about you</li>
            <li>Request correction of inaccurate data</li>
            <li>Request deletion of your data and account</li>
            <li>Disconnect calendar sources at any time</li>
            <li>Export your data in a portable format</li>
            <li>Withdraw consent for data processing</li>
          </ul>
          <Text size="sm">
            To exercise these rights, contact us at{" "}
            <a href="mailto:privacy@keeper.sh" className="text-foreground underline underline-offset-2">
              privacy@keeper.sh
            </a>
            .
          </Text>
        </Section>

        <Section title="International Data Transfers">
          <Text size="sm">
            Keeper.sh is operated from the Province of Alberta, Canada. Your information may be
            transferred to and processed in countries other than your own. We ensure appropriate
            safeguards are in place to protect your data in compliance with applicable Canadian
            privacy laws, including the Personal Information Protection and Electronic Documents
            Act (PIPEDA).
          </Text>
        </Section>

        <Section title="Children's Privacy">
          <Text size="sm">
            Keeper.sh is not intended for use by individuals under the age of 13. We do not knowingly
            collect personal information from children. If we become aware that we have collected data
            from a child, we will take steps to delete it promptly.
          </Text>
        </Section>

        <Section title="Changes to This Policy">
          <Text size="sm">
            We may update this Privacy Policy from time to time. We will notify you of significant
            changes by posting the new policy on this page and updating the &ldquo;Last updated&rdquo; date. Your
            continued use of the service after changes constitutes acceptance of the updated policy.
          </Text>
        </Section>

        <Section title="Contact Us">
          <Text size="sm">
            If you have questions or concerns about this Privacy Policy or our data practices, please
            contact us at{" "}
            <a href="mailto:privacy@keeper.sh" className="text-foreground underline underline-offset-2">
              privacy@keeper.sh
            </a>
            .
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
