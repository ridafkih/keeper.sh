import type { ReactNode } from "react";
import type { Metadata } from "next";
import { MarketingPage } from "@/components/marketing/marketing-page";

export const metadata: Metadata = {
  description:
    "Terms and conditions for using Keeper calendar synchronization service. Open-source, GPL-3.0 licensed.",
  title: "Terms & Conditions",
};

export default function TermsPage(): ReactNode {
  return (
    <MarketingPage title="Terms & Conditions" description="Last updated: December 2025">
      <div className="text-sm text-foreground-secondary flex flex-col gap-8">
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium text-foreground">Agreement to Terms</h2>
          <p>
            These Terms and Conditions ("Terms") constitute a legally binding agreement between you
            and Keeper ("we", "our", or "us") governing your access to and use of the Keeper
            calendar synchronization service.
          </p>
          <p>
            By accessing or using Keeper, you agree to be bound by these Terms. If you disagree with
            any part of these Terms, you may not access or use the service.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium text-foreground">Description of Service</h2>
          <p>
            Keeper provides calendar aggregation and synchronization services that allow you to
            combine events from multiple calendar sources into a unified, anonymized feed. The
            service includes generating iCal feeds and pushing events to external calendar
            providers.
          </p>
          <p>
            We reserve the right to modify, suspend, or discontinue any aspect of the service at any
            time, with or without notice. We shall not be liable to you or any third party for any
            modification, suspension, or discontinuation of the service.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium text-foreground">Account Registration</h2>
          <p>
            To use Keeper, you must create an account. You agree to provide accurate, current, and
            complete information during registration and to update such information as necessary.
          </p>
          <p>
            You are responsible for safeguarding your account credentials and for all activities
            that occur under your account. You agree to notify us immediately of any unauthorized
            use of your account.
          </p>
          <p>
            We reserve the right to suspend or terminate accounts that violate these Terms or that
            we reasonably believe pose a security risk.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium text-foreground">Subscription and Billing</h2>
          <p>
            Keeper offers both free and paid subscription plans. Paid subscriptions are billed in
            advance on a monthly or yearly basis. All fees are non-refundable except as required by
            law or as explicitly stated in these Terms.
          </p>
          <p>
            We may change subscription fees upon reasonable notice. Continued use of the service
            after a price change constitutes acceptance of the new fees. You may cancel your
            subscription at any time; access will continue until the end of your current billing
            period.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium text-foreground">Acceptable Use</h2>
          <p>You agree not to:</p>
          <ul className="list-disc list-inside flex flex-col gap-1 ml-2">
            <li>Use the service for any unlawful purpose or in violation of any applicable laws</li>
            <li>
              Attempt to gain unauthorized access to any part of the service or its related systems
            </li>
            <li>Interfere with or disrupt the integrity or performance of the service</li>
            <li>Use automated means to access the service beyond normal API usage</li>
            <li>Resell, sublicense, or redistribute the service without our written consent</li>
            <li>Use the service to transmit malicious code or engage in abusive behavior</li>
          </ul>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium text-foreground">Intellectual Property</h2>
          <p>
            The service and its original content, features, and functionality are owned by Keeper
            and are protected by international copyright, trademark, and other intellectual property
            laws.
          </p>
          <p>
            Keeper is open-source software licensed under the GPL-3.0 license. The source code is
            available at{" "}
            <a
              href="https://github.com/ridafkih/keeper.sh"
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground hover:underline"
            >
              github.com/ridafkih/keeper.sh
            </a>
            . Your use of the source code is governed by the terms of that license.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium text-foreground">Your Content</h2>
          <p>
            You retain ownership of any calendar data and content you provide to the service. By
            using Keeper, you grant us a limited license to access, process, and display your
            content solely as necessary to provide the service.
          </p>
          <p>
            You represent that you have the right to share any calendar data you connect to Keeper
            and that doing so does not violate any third-party rights or agreements.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium text-foreground">Third-Party Services</h2>
          <p>
            Keeper integrates with third-party calendar providers and services. Your use of these
            integrations is subject to the terms and policies of those third parties. We are not
            responsible for the practices of third-party services.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium text-foreground">Disclaimer of Warranties</h2>
          <p>
            THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND,
            EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO IMPLIED WARRANTIES OF
            MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.
          </p>
          <p>
            We do not warrant that the service will be uninterrupted, secure, or error-free, that
            defects will be corrected, or that the service is free of viruses or other harmful
            components.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium text-foreground">Limitation of Liability</h2>
          <p>
            TO THE MAXIMUM EXTENT PERMITTED BY LAW, IN NO EVENT SHALL KEEPER, ITS OFFICERS,
            DIRECTORS, EMPLOYEES, OR AGENTS BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL,
            CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING BUT NOT LIMITED TO LOSS OF PROFITS, DATA,
            USE, OR GOODWILL, ARISING OUT OF OR IN CONNECTION WITH YOUR USE OF THE SERVICE.
          </p>
          <p>
            OUR TOTAL LIABILITY FOR ANY CLAIMS ARISING FROM YOUR USE OF THE SERVICE SHALL NOT EXCEED
            THE AMOUNT YOU PAID US, IF ANY, DURING THE TWELVE (12) MONTHS PRECEDING THE CLAIM.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium text-foreground">Indemnification</h2>
          <p>
            You agree to indemnify and hold harmless Keeper and its officers, directors, employees,
            and agents from any claims, damages, losses, or expenses (including reasonable
            attorneys' fees) arising from your use of the service, violation of these Terms, or
            infringement of any third-party rights.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium text-foreground">Termination</h2>
          <p>
            We may terminate or suspend your access to the service immediately, without prior
            notice, for any reason, including breach of these Terms. Upon termination, your right to
            use the service ceases immediately.
          </p>
          <p>
            You may terminate your account at any time by deleting it through the service settings.
            Provisions of these Terms that by their nature should survive termination shall survive,
            including ownership, warranty disclaimers, and limitations of liability.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium text-foreground">Governing Law</h2>
          <p>
            These Terms shall be governed by and construed in accordance with the laws of the
            jurisdiction in which Keeper operates, without regard to conflict of law principles.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium text-foreground">Changes to Terms</h2>
          <p>
            We reserve the right to modify these Terms at any time. We will notify you of material
            changes by posting the updated Terms on this page and updating the "Last updated" date.
            Your continued use of the service after changes constitutes acceptance of the modified
            Terms.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium text-foreground">Severability</h2>
          <p>
            If any provision of these Terms is found to be unenforceable or invalid, that provision
            shall be limited or eliminated to the minimum extent necessary, and the remaining
            provisions shall remain in full force and effect.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium text-foreground">Contact Us</h2>
          <p>
            If you have questions about these Terms, please contact us at{" "}
            <a href="mailto:legal@keeper.sh" className="text-foreground hover:underline">
              legal@keeper.sh
            </a>
            .
          </p>
        </section>
      </div>
    </MarketingPage>
  );
}
