import type { PropsWithChildren } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Heading1, Heading2 } from "@/components/ui/primitives/heading";
import { Text } from "@/components/ui/primitives/text";
import { ButtonIcon, ButtonText, ExternalLinkButton, LinkButton } from "@/components/ui/primitives/button";
import { ExternalTextLink, TextLink } from "@/components/ui/primitives/text-link";
import { MarketingCtaCard, MarketingCtaSection } from "@/features/marketing/components/marketing-cta";
import { canonicalUrl, jsonLdScript, seoMeta, webPageSchema, breadcrumbSchema, breadcrumbTrail, personSchema } from "@/lib/seo";
import { Breadcrumb } from "@/components/ui/primitives/breadcrumb";
import { ANALYTICS_EVENTS } from "@/lib/analytics";
import { marketingCopy } from "@/lib/marketing-copy";
import ArrowRightIcon from "lucide-react/dist/esm/icons/arrow-right";
import ArrowUpRightIcon from "lucide-react/dist/esm/icons/arrow-up-right";

const breadcrumbs = breadcrumbTrail({ name: "About", path: "/about" });

const REPOSITORY_URL = "https://github.com/ridafkih/keeper.sh";
const PROFILE_URL = "https://github.com/ridafkih";
const PERSONAL_SITE_URL = "https://rida.dev";
const LICENSE_URL = "https://www.gnu.org/licenses/agpl-3.0.en.html";
const ORIGIN_POST_SLUG = "why-i-built-an-open-source-calendar-syncing-tool";

const about = marketingCopy.about;
const aboutSections = about.sections;
const PAGE_DESCRIPTION = about.seo.description;
const PERSON_DESCRIPTION = about.personDescription;

export const Route = createFileRoute("/(marketing)/about")({
  component: AboutPage,
  head: () => ({
    links: [{ rel: "canonical", href: canonicalUrl("/about") }],
    meta: seoMeta({
      title: about.seo.title,
      description: PAGE_DESCRIPTION,
      path: "/about",
    }),
    scripts: [
      jsonLdScript(webPageSchema(
        about.header.heading,
        about.seo.schemaDescription,
        "/about",
      )),
      jsonLdScript(personSchema(PERSON_DESCRIPTION)),
      jsonLdScript(breadcrumbSchema(breadcrumbs)),
    ],
  }),
});

function AboutPage() {
  return (
    <div className="flex flex-col gap-6 py-16">
      <Breadcrumb items={breadcrumbs} />
      <header className="flex flex-col gap-1.5">
        <Heading1>{about.header.heading}</Heading1>
        <Text size="base" tone="muted" className="max-w-[64ch] leading-6">
          {PAGE_DESCRIPTION}
        </Text>
      </header>

      <div className="flex flex-col gap-8">
        <Section title={aboutSections.who.title}>
          <Text size="sm">
            {aboutSections.who.intro}
          </Text>
          <Text size="sm">
            {aboutSections.who.linksLead}{" "}
            <TextLink align="left" size="sm" to="/blog" tone="default">{aboutSections.who.blogLinkLabel}</TextLink>
            {aboutSections.who.afterBlog}{" "}
            <ExternalTextLink align="left" href={PROFILE_URL} rel="noopener noreferrer" size="sm" target="_blank" tone="default">
              GitHub
            </ExternalTextLink>{" "}
            {aboutSections.who.afterGithub}{" "}
            <ExternalTextLink align="left" href={PERSONAL_SITE_URL} rel="noopener noreferrer" size="sm" target="_blank" tone="default">
              rida.dev
            </ExternalTextLink>
            {aboutSections.who.end}
          </Text>
        </Section>

        <Section title={aboutSections.why.title}>
          <Text size="sm">
            {aboutSections.why.p1}
          </Text>
          <Text size="sm">
            {aboutSections.why.p2}
          </Text>
          <Text size="sm">
            {aboutSections.why.p3Lead}{" "}
            <Link
              className="text-foreground underline underline-offset-2"
              params={{ slug: ORIGIN_POST_SLUG }}
              to="/blog/$slug"
            >
              {aboutSections.why.p3LinkLabel}
            </Link>
            {aboutSections.why.p3End}
          </Text>
        </Section>

        <Section title={aboutSections.code.title}>
          <Text size="sm">
            {aboutSections.code.p1Lead}{" "}
            <ExternalTextLink align="left" href={LICENSE_URL} rel="noopener noreferrer" size="sm" target="_blank" tone="default">
              {aboutSections.code.p1LinkLabel}
            </ExternalTextLink>
            {aboutSections.code.p1End}
          </Text>
          <Text size="sm">
            {aboutSections.code.p2}
          </Text>
          <Text size="sm">
            {aboutSections.code.p3Lead}{" "}
            <TextLink align="left" size="sm" to="/pricing" tone="default">{aboutSections.code.p3LinkLabel}</TextLink>
            {" "}{aboutSections.code.p3End}
          </Text>
        </Section>

        <Section title={aboutSections.support.title}>
          <Text size="sm">
            {aboutSections.support.lead}{" "}
            <ExternalTextLink align="left" href={`${REPOSITORY_URL}/issues`} rel="noopener noreferrer" size="sm" target="_blank" tone="default">
              {aboutSections.support.issuesLinkLabel}
            </ExternalTextLink>
            {aboutSections.support.afterIssues}{" "}
            <a href="mailto:support@keeper.sh" className="text-foreground underline underline-offset-2">
              support@keeper.sh
            </a>
            .
          </Text>
        </Section>
      </div>

      <MarketingCtaSection>
        <MarketingCtaCard>
          <Heading2 className="text-center text-white">{about.cta.heading}</Heading2>
          <Text size="sm" align="center" tone="highlight" className="max-w-[46ch]">
            {about.cta.body}
          </Text>
          <div className="flex items-center gap-2 mt-2">
            <LinkButton
              to="/register"
              size="compact"
              variant="inverse"
              data-visitors-event={ANALYTICS_EVENTS.marketing_cta_clicked}
              data-visitors-cta="about"
            >
              <ButtonText>{about.cta.primaryLabel}</ButtonText>
              <ButtonIcon>
                <ArrowRightIcon size={16} />
              </ButtonIcon>
            </LinkButton>
            <ExternalLinkButton
              href={REPOSITORY_URL}
              target="_blank"
              rel="noreferrer"
              size="compact"
              variant="inverse-ghost"
            >
              <ButtonText>{about.cta.secondaryLabel}</ButtonText>
              <ButtonIcon>
                <ArrowUpRightIcon size={16} />
              </ButtonIcon>
            </ExternalLinkButton>
          </div>
        </MarketingCtaCard>
      </MarketingCtaSection>
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
