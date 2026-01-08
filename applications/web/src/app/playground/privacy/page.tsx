import type { Metadata } from "next";

import { Heading1, Heading2, Heading3 } from "../components/heading";
import { Copy } from "../components/copy";
import { LinkOut } from "../components/link-out";
import { SuperscriptLink } from "../components/superscript-link";
import {
  InlineTable,
  InlineTableHeader,
  InlineTableBody,
  InlineTableRow,
  InlineTableHead,
  InlineTableCell,
  InlineTableList,
  InlineTableListItem,
} from "../components/inline-table";
import { LegalSection } from "../components/legal-section";

export const metadata: Metadata = {
  description:
    "Learn how Keeper collects, uses, and protects your data. We prioritize your privacy and are transparent about our data practices.",
  title: "Privacy Policy",
};

const PrivacyPage = () => (
  <>
    <div className="flex flex-col gap-2">
      <Heading1>Privacy Policy</Heading1>
      <Copy>This privacy policy was last updated on January 7th, 2025.</Copy>
    </div>

    <div className="flex flex-col gap-8">
      <LegalSection>
        <Heading2>Overview</Heading2>
        <Copy>
          Keeper (&quot;we&quot;, &quot;our&quot;, or &quot;us&quot;) is committed to protecting your
          privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your
          information when you use our calendar synchronization service.
        </Copy>
        <Copy>
          By using Keeper, you consent to the data practices described in this policy. If you do not
          agree with the terms of this policy, please do not access or use our service.
        </Copy>
      </LegalSection>

      <LegalSection>
        <Heading2>Information We Collect</Heading2>
        <Heading3>Account Information</Heading3>
        <Copy>
          When you create an account, we collect your email address and authentication credentials.
          If you sign up using a third-party provider, we receive basic profile information as
          permitted by your privacy settings with that provider.
        </Copy>
        <Heading3>Calendar Data</Heading3>
        <Copy>
          To provide our service, we access calendar data from sources you connect. This includes
          event titles, times, durations, and associated metadata. We only access calendars you
          explicitly authorize.
        </Copy>
        <Heading3>Usage Data</Heading3>
        <Copy>
          We automatically collect certain information when you access our service, including your
          IP address, browser type, operating system, access times, and pages viewed. This data
          helps us improve our service and diagnose technical issues.
        </Copy>
      </LegalSection>

      <LegalSection>
        <Heading2>How We Use Your Information</Heading2>
        <Copy>We use the information we collect to:</Copy>
        <ul className="list-disc list-inside flex flex-col gap-1 ml-2">
          <Copy as="li">Provide, maintain, and improve our calendar syncing service</Copy>
          <Copy as="li">Push synchronized events to your designated destination calendars</Copy>
          <Copy as="li">Send service-related communications and respond to inquiries</Copy>
          <Copy as="li">Monitor and analyze usage patterns to improve user experience</Copy>
          <Copy as="li">Detect, prevent, and address technical issues or abuse</Copy>
        </ul>
      </LegalSection>

      <LegalSection>
        <Heading2>Third-Party Data Providers</Heading2>
        <Copy>
          We integrate with the following third-party services. This table details exactly what data
          each provider accesses and under what circumstances.
        </Copy>
        <InlineTable>
          <InlineTableHeader>
            <InlineTableHead>Provider</InlineTableHead>
            <InlineTableHead>Data Collected</InlineTableHead>
            <InlineTableHead>When</InlineTableHead>
          </InlineTableHeader>
          <InlineTableBody>
            <InlineTableRow>
              <InlineTableCell>
                Vercel
                <SuperscriptLink href="https://vercel.com/legal/privacy-policy" />
              </InlineTableCell>
              <InlineTableList>
                <InlineTableListItem>IP-derived country</InlineTableListItem>
                <InlineTableListItem>Web vitals</InlineTableListItem>
                <InlineTableListItem>Page performance</InlineTableListItem>
              </InlineTableList>
              <InlineTableCell>All requests</InlineTableCell>
            </InlineTableRow>
            <InlineTableRow>
              <InlineTableCell>
                Railway
                <SuperscriptLink href="https://railway.app/legal/privacy" />
              </InlineTableCell>
              <InlineTableList>
                <InlineTableListItem>User ID</InlineTableListItem>
                <InlineTableListItem>Subscription status</InlineTableListItem>
                <InlineTableListItem>Account age</InlineTableListItem>
              </InlineTableList>
              <InlineTableCell>All requests</InlineTableCell>
            </InlineTableRow>
            <InlineTableRow>
              <InlineTableCell>
                visitors.now
                <SuperscriptLink href="https://visitors.now" />
              </InlineTableCell>
              <InlineTableList>
                <InlineTableListItem>Page views</InlineTableListItem>
                <InlineTableListItem>Custom events</InlineTableListItem>
                <InlineTableListItem>User ID</InlineTableListItem>
              </InlineTableList>
              <InlineTableCell>With consent</InlineTableCell>
            </InlineTableRow>
            <InlineTableRow>
              <InlineTableCell>
                Google
                <SuperscriptLink href="https://policies.google.com/privacy" />
              </InlineTableCell>
              <InlineTableList>
                <InlineTableListItem>Email</InlineTableListItem>
                <InlineTableListItem>Profile</InlineTableListItem>
                <InlineTableListItem>Calendar events</InlineTableListItem>
                <InlineTableListItem>Conversion events</InlineTableListItem>
              </InlineTableList>
              <InlineTableCell>When connecting account or with consent</InlineTableCell>
            </InlineTableRow>
            <InlineTableRow>
              <InlineTableCell>
                Microsoft
                <SuperscriptLink href="https://privacy.microsoft.com" />
              </InlineTableCell>
              <InlineTableList>
                <InlineTableListItem>Email</InlineTableListItem>
                <InlineTableListItem>Profile</InlineTableListItem>
                <InlineTableListItem>Calendar events</InlineTableListItem>
              </InlineTableList>
              <InlineTableCell>When connecting account</InlineTableCell>
            </InlineTableRow>
            <InlineTableRow>
              <InlineTableCell>
                Polar
                <SuperscriptLink href="https://polar.sh/legal/privacy" />
              </InlineTableCell>
              <InlineTableList>
                <InlineTableListItem>Payment info</InlineTableListItem>
                <InlineTableListItem>Subscription status</InlineTableListItem>
              </InlineTableList>
              <InlineTableCell>At checkout</InlineTableCell>
            </InlineTableRow>
            <InlineTableRow last>
              <InlineTableCell>
                Resend
                <SuperscriptLink href="https://resend.com/legal/privacy-policy" />
              </InlineTableCell>
              <InlineTableList>
                <InlineTableListItem>Email address</InlineTableListItem>
              </InlineTableList>
              <InlineTableCell>On registration</InlineTableCell>
            </InlineTableRow>
          </InlineTableBody>
        </InlineTable>
        <Copy>
          We do not sell, trade, or otherwise transfer your personal information to third parties
          for marketing purposes.
        </Copy>
      </LegalSection>

      <LegalSection>
        <Heading2>Data Retention</Heading2>
        <Copy>
          We retain your account information and calendar data for as long as your account is
          active. When you delete your account, we immediately delete all associated data, except
          where retention is required by law.
        </Copy>
      </LegalSection>

      <LegalSection>
        <Heading2>Your Rights and Choices</Heading2>
        <Copy>You have the right to:</Copy>
        <ul className="list-disc list-inside flex flex-col gap-1 ml-2">
          <Copy as="li">Access the personal data we hold about you</Copy>
          <Copy as="li">Request correction of inaccurate data</Copy>
          <Copy as="li">Request deletion of your data and account</Copy>
          <Copy as="li">Disconnect calendar sources at any time</Copy>
          <Copy as="li">Export your data in a portable format</Copy>
          <Copy as="li">Withdraw consent for data processing</Copy>
        </ul>
        <Copy>
          To exercise these rights, contact us at{" "}
          <LinkOut variant="inline" href="mailto:privacy@keeper.sh">
            privacy@keeper.sh
          </LinkOut>
          .
        </Copy>
      </LegalSection>

      <LegalSection>
        <Heading2>International Data Transfers</Heading2>
        <Copy>
          Your information may be transferred to and processed in countries other than your own. We
          ensure appropriate safeguards are in place to protect your data in compliance with
          applicable laws.
        </Copy>
      </LegalSection>

      <LegalSection>
        <Heading2>Children&apos;s Privacy</Heading2>
        <Copy>
          Keeper is not intended for use by individuals under the age of 13. We do not knowingly
          collect personal information from children. If we become aware that we have collected data
          from a child, we will take steps to delete it promptly.
        </Copy>
      </LegalSection>

      <LegalSection>
        <Heading2>Changes to This Policy</Heading2>
        <Copy>
          We may update this Privacy Policy from time to time. We will notify you of significant
          changes by posting the new policy on this page and updating the &quot;Last updated&quot;
          date. Your continued use of the service after changes constitutes acceptance of the
          updated policy.
        </Copy>
      </LegalSection>

      <LegalSection>
        <Heading2>Contact Us</Heading2>
        <Copy>
          If you have questions or concerns about this Privacy Policy or our data practices, please
          contact us at{" "}
          <LinkOut variant="inline" href="mailto:privacy@keeper.sh">
            privacy@keeper.sh
          </LinkOut>
          .
        </Copy>
      </LegalSection>
    </div>
  </>
);

export default PrivacyPage;
