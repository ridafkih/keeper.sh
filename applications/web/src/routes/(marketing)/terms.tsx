import type { PropsWithChildren } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Heading1, Heading2 } from "../../components/ui/primitives/heading";
import { Text } from "../../components/ui/primitives/text";
import { canonicalUrl, jsonLdMeta, seoMeta, webPageSchema, breadcrumbSchema } from "../../lib/seo";
import { termsPageMetadata, formatMonthYear } from "../../lib/page-metadata";

export const Route = createFileRoute("/(marketing)/terms")({
  component: TermsPage,
  head: () => ({
    links: [{ rel: "canonical", href: canonicalUrl("/terms") }],
    meta: [
      ...seoMeta({
        title: "Terms & Conditions",
        description:
          "Terms of service for Keeper.sh. Covers account registration, subscription billing, acceptable use, and data ownership for our calendar syncing service.",
        path: "/terms",
      }),
      jsonLdMeta(webPageSchema("Terms & Conditions", "Terms and conditions for using Keeper.sh, the open-source calendar syncing service.", "/terms")),
      jsonLdMeta(breadcrumbSchema([{ name: "Home", path: "/" }, { name: "Terms & Conditions", path: "/terms" }])),
    ],
  }),
});

function TermsPage() {
  return (
    <div className="flex flex-col gap-6 py-16">
      <div className="flex flex-col gap-1">
        <Heading1>Terms &amp; Conditions</Heading1>
        <Text size="sm" tone="muted">Last updated: {formatMonthYear(termsPageMetadata.updatedAt)}</Text>
      </div>
      <div className="flex flex-col gap-8">
        <Section title="Agreement to Terms">
          <Text size="sm">
            These Terms and Conditions (&ldquo;Terms&rdquo;) constitute a legally binding agreement between you
            and Keeper.sh (&ldquo;we&rdquo;, &ldquo;our&rdquo;, or &ldquo;us&rdquo;) governing your access to and use of the Keeper.sh calendar
            synchronization service.
          </Text>
          <Text size="sm">
            By accessing or using Keeper.sh, you agree to be bound by these Terms. If you disagree with
            any part of these Terms, you may not access or use the service.
          </Text>
        </Section>

        <Section title="Description of Service">
          <Text size="sm">
            Keeper.sh provides calendar aggregation and synchronization services that allow you to
            combine events from multiple calendar sources into a unified, anonymized feed. The service
            includes generating iCal feeds and pushing events to external calendar providers.
          </Text>
          <Text size="sm">
            We reserve the right to modify, suspend, or discontinue any aspect of the service at any
            time, with or without notice. We shall not be liable to you or any third party for any
            modification, suspension, or discontinuation of the service.
          </Text>
        </Section>

        <Section title="Account Registration">
          <Text size="sm">
            To use Keeper.sh, you must create an account. You agree to provide accurate, current, and
            complete information during registration and to update such information as necessary.
          </Text>
          <Text size="sm">
            You are responsible for safeguarding your account credentials and for all activities that
            occur under your account. You agree to notify us immediately of any unauthorized use of
            your account.
          </Text>
          <Text size="sm">
            We reserve the right to suspend or terminate accounts that violate these Terms or that we
            reasonably believe pose a security risk.
          </Text>
        </Section>

        <Section title="Subscription and Billing">
          <Text size="sm">
            Keeper.sh offers both free and paid subscription plans. Paid subscriptions are billed in
            advance on a monthly or yearly basis. All fees are non-refundable except as required by
            law or as explicitly stated in these Terms.
          </Text>
          <Text size="sm">
            We may change subscription fees upon reasonable notice. Continued use of the service after
            a price change constitutes acceptance of the new fees. You may cancel your subscription at
            any time; access will continue until the end of your current billing period.
          </Text>
        </Section>

        <Section title="Acceptable Use">
          <Text size="sm">You agree not to:</Text>
          <ul className="list-disc list-inside flex flex-col gap-1 ml-2 text-sm tracking-tight text-foreground-muted">
            <li>Use the service for any unlawful purpose or in violation of any applicable laws</li>
            <li>Attempt to gain unauthorized access to any part of the service or its related systems</li>
            <li>Interfere with or disrupt the integrity or performance of the service</li>
            <li>Use automated means to access the service beyond normal API usage</li>
            <li>Resell, sublicense, or redistribute the service without our written consent</li>
            <li>Use the service to transmit malicious code or engage in abusive behavior</li>
          </ul>
        </Section>

        <Section title="Intellectual Property">
          <Text size="sm">
            The service and its original content, features, and functionality are owned by Keeper.sh and
            are protected by international copyright, trademark, and other intellectual property laws.
          </Text>
          <Text size="sm">
            Keeper.sh is open-source software licensed under the AGPL-3.0 license. The source code is
            available at{" "}
            <a href="https://github.com/ridafkih/keeper.sh" target="_blank" rel="noopener noreferrer" className="text-foreground underline underline-offset-2">
              github.com/ridafkih/keeper.sh
            </a>
            . Your use of the source code is governed by the terms of that license.
          </Text>
        </Section>

        <Section title="Your Content">
          <Text size="sm">
            You retain ownership of any calendar data and content you provide to the service. By using
            Keeper.sh, you grant us a limited license to access, process, and display your content solely
            as necessary to provide the service.
          </Text>
          <Text size="sm">
            You represent that you have the right to share any calendar data you connect to Keeper.sh and
            that doing so does not violate any third-party rights or agreements.
          </Text>
        </Section>

        <Section title="Third-Party Services">
          <Text size="sm">
            Keeper.sh integrates with third-party calendar providers and services. Your use of these
            integrations is subject to the terms and policies of those third parties. We are not
            responsible for the practices of third-party services.
          </Text>
        </Section>

        <Section title="Disclaimer of Warranties">
          <Text size="sm">
            THE SERVICE IS PROVIDED &ldquo;AS IS&rdquo; AND &ldquo;AS AVAILABLE&rdquo; WITHOUT WARRANTIES OF ANY KIND, EITHER
            EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO IMPLIED WARRANTIES OF MERCHANTABILITY,
            FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.
          </Text>
          <Text size="sm">
            We do not warrant that the service will be uninterrupted, secure, or error-free, that
            defects will be corrected, or that the service is free of viruses or other harmful
            components.
          </Text>
        </Section>

        <Section title="Limitation of Liability">
          <Text size="sm">
            TO THE MAXIMUM EXTENT PERMITTED BY LAW, IN NO EVENT SHALL KEEPER.SH, ITS OFFICERS, DIRECTORS,
            EMPLOYEES, OR AGENTS BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR
            PUNITIVE DAMAGES, INCLUDING BUT NOT LIMITED TO LOSS OF PROFITS, DATA, USE, OR GOODWILL,
            ARISING OUT OF OR IN CONNECTION WITH YOUR USE OF THE SERVICE.
          </Text>
          <Text size="sm">
            OUR TOTAL LIABILITY FOR ANY CLAIMS ARISING FROM YOUR USE OF THE SERVICE SHALL NOT EXCEED
            THE AMOUNT YOU PAID US, IF ANY, DURING THE TWELVE (12) MONTHS PRECEDING THE CLAIM.
          </Text>
        </Section>

        <Section title="Indemnification">
          <Text size="sm">
            You agree to indemnify and hold harmless Keeper.sh and its officers, directors, employees,
            and agents from any claims, damages, losses, or expenses (including reasonable attorneys&apos;
            fees) arising from your use of the service, violation of these Terms, or infringement of
            any third-party rights.
          </Text>
        </Section>

        <Section title="Termination">
          <Text size="sm">
            We may terminate or suspend your access to the service immediately, without prior notice,
            for any reason, including breach of these Terms. Upon termination, your right to use the
            service ceases immediately.
          </Text>
          <Text size="sm">
            You may terminate your account at any time by deleting it through the service settings.
            Provisions of these Terms that by their nature should survive termination shall survive,
            including ownership, warranty disclaimers, and limitations of liability.
          </Text>
        </Section>

        <Section title="Governing Law">
          <Text size="sm">
            These Terms shall be governed by and construed in accordance with the laws of the
            Province of Alberta, Canada, and the federal laws of Canada applicable therein, without
            regard to conflict of law principles. Any disputes arising under these Terms shall be
            subject to the exclusive jurisdiction of the courts of the Province of Alberta.
          </Text>
        </Section>

        <Section title="Changes to Terms">
          <Text size="sm">
            We reserve the right to modify these Terms at any time. We will notify you of material
            changes by posting the updated Terms on this page and updating the &ldquo;Last updated&rdquo; date.
            Your continued use of the service after changes constitutes acceptance of the modified
            Terms.
          </Text>
        </Section>

        <Section title="Severability">
          <Text size="sm">
            If any provision of these Terms is found to be unenforceable or invalid, that provision
            shall be limited or eliminated to the minimum extent necessary, and the remaining
            provisions shall remain in full force and effect.
          </Text>
        </Section>

        <Section title="Contact Us">
          <Text size="sm">
            If you have questions about these Terms, please contact us at{" "}
            <a href="mailto:legal@keeper.sh" className="text-foreground underline underline-offset-2">
              legal@keeper.sh
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
