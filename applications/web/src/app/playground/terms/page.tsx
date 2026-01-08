import type { Metadata } from "next";

import { Heading1, Heading2 } from "../components/heading";
import { Copy } from "../components/copy";
import { LinkOut } from "../components/link-out";
import { LegalSection } from "../components/legal-section";

export const metadata: Metadata = {
  description:
    "Terms and conditions for using Keeper calendar synchronization service. Open-source, AGPL-3.0 licensed.",
  title: "Terms & Conditions",
};

const TermsPage = () => (
  <>
    <div className="flex flex-col gap-2">
      <Heading1>Terms &amp; Conditions</Heading1>
      <Copy>This document was last updated on January 7th, 2025.</Copy>
    </div>

    <div className="flex flex-col gap-8">
      <LegalSection>
        <Heading2>Agreement to Terms</Heading2>
        <Copy>
          These Terms and Conditions (&quot;Terms&quot;) constitute a legally binding agreement
          between you and Keeper (&quot;we&quot;, &quot;our&quot;, or &quot;us&quot;) governing your
          access to and use of the Keeper calendar synchronization service.
        </Copy>
        <Copy>
          By accessing or using Keeper, you agree to be bound by these Terms. If you disagree with
          any part of these Terms, you may not access or use the service.
        </Copy>
      </LegalSection>

      <LegalSection>
        <Heading2>Description of Service</Heading2>
        <Copy>
          Keeper provides calendar aggregation and synchronization services that allow you to
          combine events from multiple calendar sources into a unified, anonymized feed. The service
          includes generating iCal feeds and pushing events to external calendar providers.
        </Copy>
        <Copy>
          We reserve the right to modify, suspend, or discontinue any aspect of the service at any
          time, with or without notice. We shall not be liable to you or any third party for any
          modification, suspension, or discontinuation of the service.
        </Copy>
      </LegalSection>

      <LegalSection>
        <Heading2>Account Registration</Heading2>
        <Copy>
          To use Keeper, you must create an account. You agree to provide accurate, current, and
          complete information during registration and to update such information as necessary.
        </Copy>
        <Copy>
          You are responsible for safeguarding your account credentials and for all activities that
          occur under your account. You agree to notify us immediately of any unauthorized use of
          your account.
        </Copy>
        <Copy>
          We reserve the right to suspend or terminate accounts that violate these Terms or that we
          reasonably believe pose a security risk.
        </Copy>
      </LegalSection>

      <LegalSection>
        <Heading2>Subscription and Billing</Heading2>
        <Copy>
          Keeper offers both free and paid subscription plans. Paid subscriptions are billed in
          advance on a monthly or yearly basis. All fees are non-refundable except as required by
          law or as explicitly stated in these Terms.
        </Copy>
        <Copy>
          We may change subscription fees upon reasonable notice. Continued use of the service after
          a price change constitutes acceptance of the new fees. You may cancel your subscription at
          any time; access will continue until the end of your current billing period.
        </Copy>
      </LegalSection>

      <LegalSection>
        <Heading2>Acceptable Use</Heading2>
        <Copy>You agree not to:</Copy>
        <ul className="list-disc list-inside flex flex-col gap-1 ml-2">
          <Copy as="li">Use the service for any unlawful purpose or in violation of any applicable laws</Copy>
          <Copy as="li">
            Attempt to gain unauthorized access to any part of the service or its related systems
          </Copy>
          <Copy as="li">Interfere with or disrupt the integrity or performance of the service</Copy>
          <Copy as="li">Use automated means to access the service beyond normal API usage</Copy>
          <Copy as="li">Resell, sublicense, or redistribute the service without our written consent</Copy>
          <Copy as="li">Use the service to transmit malicious code or engage in abusive behavior</Copy>
        </ul>
      </LegalSection>

      <LegalSection>
        <Heading2>Intellectual Property</Heading2>
        <Copy>
          The service and its original content, features, and functionality are owned by Keeper and
          are protected by international copyright, trademark, and other intellectual property laws.
        </Copy>
        <Copy>
          Keeper is open-source software licensed under the AGPL-3.0 license. The source code is
          available at{" "}
          <LinkOut variant="inline" href="https://github.com/ridafkih/keeper.sh">
            github.com/ridafkih/keeper.sh
          </LinkOut>
          . Your use of the source code is governed by the terms of that license.
        </Copy>
      </LegalSection>

      <LegalSection>
        <Heading2>Your Content</Heading2>
        <Copy>
          You retain ownership of any calendar data and content you provide to the service. By using
          Keeper, you grant us a limited license to access, process, and display your content solely
          as necessary to provide the service.
        </Copy>
        <Copy>
          You represent that you have the right to share any calendar data you connect to Keeper and
          that doing so does not violate any third-party rights or agreements.
        </Copy>
      </LegalSection>

      <LegalSection>
        <Heading2>Third-Party Services</Heading2>
        <Copy>
          Keeper integrates with third-party calendar providers and services. Your use of these
          integrations is subject to the terms and policies of those third parties. We are not
          responsible for the practices of third-party services.
        </Copy>
      </LegalSection>

      <LegalSection>
        <Heading2>Service Disclaimer</Heading2>
        <Copy>
          Keeper is provided as-is, without guarantees of any kind. We do our best to keep the
          service running smoothly, but we can&apos;t promise it will always be available,
          error-free, or meet your specific needs.
        </Copy>
        <Copy>
          We&apos;re not liable for any damages, data loss, or other issues arising from your use of
          the service. If you&apos;ve paid for a subscription, any liability is limited to the
          amount you&apos;ve paid us in the past twelve months.
        </Copy>
      </LegalSection>

      <LegalSection>
        <Heading2>Indemnification</Heading2>
        <Copy>
          You agree to indemnify and hold harmless Keeper and its maintainers from any claims,
          damages, losses, or expenses (including reasonable legal fees) arising from your use of the
          service, violation of these Terms, or infringement of any third-party rights.
        </Copy>
      </LegalSection>

      <LegalSection>
        <Heading2>Termination</Heading2>
        <Copy>
          We may terminate or suspend your access to the service immediately, without prior notice,
          for any reason, including breach of these Terms. Upon termination, your right to use the
          service ceases immediately.
        </Copy>
        <Copy>
          You may terminate your account at any time by deleting it through the service settings.
          Provisions of these Terms that by their nature should survive termination shall survive,
          including ownership, warranty disclaimers, and limitations of liability.
        </Copy>
      </LegalSection>

      <LegalSection>
        <Heading2>Governing Law</Heading2>
        <Copy>
          These Terms shall be governed by and construed in accordance with the laws of Canada,
          without regard to conflict of law principles.
        </Copy>
      </LegalSection>

      <LegalSection>
        <Heading2>Changes to Terms</Heading2>
        <Copy>
          We reserve the right to modify these Terms at any time. We will notify you of material
          changes by posting the updated Terms on this page and updating the &quot;Last
          updated&quot; date. Your continued use of the service after changes constitutes acceptance
          of the modified Terms.
        </Copy>
      </LegalSection>

      <LegalSection>
        <Heading2>Severability</Heading2>
        <Copy>
          If any provision of these Terms is found to be unenforceable or invalid, that provision
          shall be limited or eliminated to the minimum extent necessary, and the remaining
          provisions shall remain in full force and effect.
        </Copy>
      </LegalSection>

      <LegalSection>
        <Heading2>Contact Us</Heading2>
        <Copy>
          If you have questions about these Terms, please contact us at{" "}
          <LinkOut variant="inline" href="mailto:legal@keeper.sh">
            legal@keeper.sh
          </LinkOut>
          .
        </Copy>
      </LegalSection>
    </div>
  </>
);

export default TermsPage;
