import type { ReactNode } from "react";
import type { Metadata } from "next";
import { MarketingPage } from "@/components/marketing/marketing-page";

export const metadata: Metadata = {
  description:
    "Learn how Keeper collects, uses, and protects your data. We anonymize calendar events and prioritize your privacy.",
  title: "Privacy Policy",
};

export default function PrivacyPage(): ReactNode {
  return (
    <MarketingPage title="Privacy Policy" description="Last updated: December 2025">
      <div className="text-sm text-foreground-secondary flex flex-col gap-8">
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium text-foreground">Overview</h2>
          <p>
            Keeper ("we", "our", or "us") is committed to protecting your privacy. This Privacy
            Policy explains how we collect, use, disclose, and safeguard your information when you
            use our calendar synchronization service.
          </p>
          <p>
            By using Keeper, you consent to the data practices described in this policy. If you do
            not agree with the terms of this policy, please do not access or use our service.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium text-foreground">Information We Collect</h2>
          <h3 className="text-base font-medium text-foreground">Account Information</h3>
          <p>
            When you create an account, we collect your email address and authentication
            credentials. If you sign up using a third-party provider (such as Google), we receive
            basic profile information as permitted by your privacy settings with that provider.
          </p>
          <h3 className="text-base font-medium text-foreground">Calendar Data</h3>
          <p>
            To provide our service, we access calendar data from sources you connect. This includes
            event titles, times, durations, and associated metadata. We only access calendars you
            explicitly authorize.
          </p>
          <h3 className="text-base font-medium text-foreground">Usage Data</h3>
          <p>
            We automatically collect certain information when you access our service, including your
            IP address, browser type, operating system, access times, and pages viewed. This data
            helps us improve our service and diagnose technical issues.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium text-foreground">How We Use Your Information</h2>
          <p>We use the information we collect to:</p>
          <ul className="list-disc list-inside flex flex-col gap-1 ml-2">
            <li>Provide, maintain, and improve our calendar syncing service</li>
            <li>
              Aggregate and anonymize calendar events for shared feeds, showing only busy/free
              status
            </li>
            <li>Push synchronized events to your designated destination calendars</li>
            <li>Send service-related communications and respond to inquiries</li>
            <li>Monitor and analyze usage patterns to improve user experience</li>
            <li>Detect, prevent, and address technical issues or abuse</li>
          </ul>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium text-foreground">Data Anonymization</h2>
          <p>
            A core feature of Keeper is event anonymization. When you generate a shared iCal feed or
            push to external calendars, event details (titles, descriptions, attendees, locations)
            are stripped. Only busy/free time blocks are shared, protecting the privacy of your
            schedule details.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium text-foreground">Data Storage and Security</h2>
          <p>
            Your data is stored on secure servers with encryption at rest and in transit. We
            implement industry-standard security measures including access controls, monitoring, and
            regular security assessments.
          </p>
          <p>
            Calendar data is cached temporarily to enable synchronization and is refreshed according
            to your plan's sync interval. We do not retain historical calendar data beyond what is
            necessary for the service to function.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium text-foreground">Data Retention</h2>
          <p>
            We retain your account information and calendar data for as long as your account is
            active. When you delete your account, we delete all associated data within 30 days,
            except where retention is required by law or for legitimate business purposes (such as
            fraud prevention).
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium text-foreground">Third-Party Services</h2>
          <p>
            We integrate with third-party calendar providers (such as Google Calendar) to access and
            sync your calendar data. These integrations are governed by the respective providers'
            terms and privacy policies. We only request the minimum permissions necessary to provide
            our service.
          </p>
          <p>
            We use third-party services for payment processing (Polar). Payment information is
            handled directly by these processors and is not stored on our servers.
          </p>
          <p>
            We do not sell, trade, or otherwise transfer your personal information to third parties
            for marketing purposes.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium text-foreground">Your Rights and Choices</h2>
          <p>You have the right to:</p>
          <ul className="list-disc list-inside flex flex-col gap-1 ml-2">
            <li>Access the personal data we hold about you</li>
            <li>Request correction of inaccurate data</li>
            <li>Request deletion of your data and account</li>
            <li>Disconnect calendar sources at any time</li>
            <li>Export your data in a portable format</li>
            <li>Withdraw consent for data processing</li>
          </ul>
          <p>
            To exercise these rights, contact us at{" "}
            <a href="mailto:privacy@keeper.sh" className="text-foreground hover:underline">
              privacy@keeper.sh
            </a>
            .
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium text-foreground">International Data Transfers</h2>
          <p>
            Your information may be transferred to and processed in countries other than your own.
            We ensure appropriate safeguards are in place to protect your data in compliance with
            applicable laws.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium text-foreground">Children's Privacy</h2>
          <p>
            Keeper is not intended for use by individuals under the age of 13. We do not knowingly
            collect personal information from children. If we become aware that we have collected
            data from a child, we will take steps to delete it promptly.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium text-foreground">Changes to This Policy</h2>
          <p>
            We may update this Privacy Policy from time to time. We will notify you of significant
            changes by posting the new policy on this page and updating the "Last updated" date.
            Your continued use of the service after changes constitutes acceptance of the updated
            policy.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium text-foreground">Contact Us</h2>
          <p>
            If you have questions or concerns about this Privacy Policy or our data practices,
            please contact us at{" "}
            <a href="mailto:privacy@keeper.sh" className="text-foreground hover:underline">
              privacy@keeper.sh
            </a>
            .
          </p>
        </section>
      </div>
    </MarketingPage>
  );
}
