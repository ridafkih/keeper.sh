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
import ArrowRightIcon from "lucide-react/dist/esm/icons/arrow-right";
import ArrowUpRightIcon from "lucide-react/dist/esm/icons/arrow-up-right";

const breadcrumbs = breadcrumbTrail({ name: "About", path: "/about" });

const REPOSITORY_URL = "https://github.com/ridafkih/keeper.sh";
const PROFILE_URL = "https://github.com/ridafkih";
const PERSONAL_SITE_URL = "https://rida.dev";
const LICENSE_URL = "https://www.gnu.org/licenses/agpl-3.0.en.html";
const ORIGIN_POST_SLUG = "why-i-built-an-open-source-calendar-syncing-tool";

const PAGE_DESCRIPTION =
  "Keeper.sh is built and maintained by Rida F'kih. It started as a fix for four calendars that kept double-booking each other, and it is released under AGPL-3.0 so anyone can read what it does with their events.";

const PERSON_DESCRIPTION =
  "Rida F'kih is the author and maintainer of Keeper.sh, the open-source calendar syncing service, and writes the posts on its blog.";

export const Route = createFileRoute("/(marketing)/about")({
  component: AboutPage,
  head: () => ({
    links: [{ rel: "canonical", href: canonicalUrl("/about") }],
    meta: seoMeta({
      title: "About",
      description: PAGE_DESCRIPTION,
      path: "/about",
    }),
    scripts: [
      jsonLdScript(webPageSchema(
        "About Keeper.sh",
        "Who builds Keeper.sh, why it exists, and why it is licensed under AGPL-3.0.",
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
        <Heading1>About Keeper.sh</Heading1>
        <Text size="base" tone="muted" className="max-w-[64ch] leading-6">
          {PAGE_DESCRIPTION}
        </Text>
      </header>

      <div className="flex flex-col gap-8">
        <Section title="Who builds it">
          <Text size="sm">
            Keeper.sh is written and maintained by Rida F&apos;kih, who holds the copyright on the project and
            releases it under AGPL-3.0. The sync engine, the API, the MCP server and this website are all in
            one public repository, so the work is reviewable commit by commit rather than described from a
            distance.
          </Text>
          <Text size="sm">
            He also writes the posts on the{" "}
            <TextLink align="left" size="sm" to="/blog" tone="default">blog</TextLink>
            , which is where the comparisons, the provider guides and the reasoning behind the product
            decisions live. You can find him on{" "}
            <ExternalTextLink align="left" href={PROFILE_URL} rel="noopener noreferrer" size="sm" target="_blank" tone="default">
              GitHub
            </ExternalTextLink>{" "}
            and at{" "}
            <ExternalTextLink align="left" href={PERSONAL_SITE_URL} rel="noopener noreferrer" size="sm" target="_blank" tone="default">
              rida.dev
            </ExternalTextLink>
            .
          </Text>
        </Section>

        <Section title="Why it exists">
          <Text size="sm">
            It started with four calendars: a work calendar and a business calendar on Google, a
            business-personal one on Fastmail, and a personal one on iCloud. Everyone who tried to book time
            saw a different, incomplete version of the week, and meetings landed on top of each other.
          </Text>
          <Text size="sm">
            The tools that already existed charged per calendar, which meant they charged the most for
            exactly the problem being solved, and none of them read Fastmail. They also wanted the contents
            of the events. What was actually needed was smaller than that: block the same time everywhere,
            and say nothing about why. That is the job Keeper.sh does, and details are something you turn on
            rather than remember to turn off.
          </Text>
          <Text size="sm">
            The longer version of that story is in{" "}
            <Link
              className="text-foreground underline underline-offset-2"
              params={{ slug: ORIGIN_POST_SLUG }}
              to="/blog/$slug"
            >
              the post about building it
            </Link>
            .
          </Text>
        </Section>

        <Section title="Why AGPL-3.0">
          <Text size="sm">
            A calendar sync tool has to read whole events to work out when you are busy, so the honest answer
            to &ldquo;what happens to my events?&rdquo; is source code rather than a policy page. Keeper.sh is
            licensed under{" "}
            <ExternalTextLink align="left" href={LICENSE_URL} rel="noopener noreferrer" size="sm" target="_blank" tone="default">
              AGPL-3.0
            </ExternalTextLink>
            , and the hosted service at keeper.sh runs the same code that is in the repository.
          </Text>
          <Text size="sm">
            The AGPL matters more than a permissive license here because this software is normally used over
            a network. Anyone who runs a modified version as a service has to make their changes available
            under the same terms, which keeps improvements in the open instead of ending up in a closed fork
            of the thing you were relying on.
          </Text>
          <Text size="sm">
            Self-hosting is a first-class path rather than a stripped-down one: every account on a
            self-hosted instance gets every paid sync feature, with no plan limits. Paying for the{" "}
            <TextLink align="left" size="sm" to="/pricing" tone="default">hosted version</TextLink>
            {" "}buys the server, the upgrades and the backups, and it funds the work on both.
          </Text>
        </Section>

        <Section title="Getting in touch">
          <Text size="sm">
            Bugs and feature requests are best filed as{" "}
            <ExternalTextLink align="left" href={`${REPOSITORY_URL}/issues`} rel="noopener noreferrer" size="sm" target="_blank" tone="default">
              issues on GitHub
            </ExternalTextLink>
            , where they are triaged in public. For anything else, email{" "}
            <a href="mailto:support@keeper.sh" className="text-foreground underline underline-offset-2">
              support@keeper.sh
            </a>
            .
          </Text>
        </Section>
      </div>

      <MarketingCtaSection>
        <MarketingCtaCard>
          <Heading2 className="text-center text-white">Ready to stop double-booking?</Heading2>
          <Text size="sm" align="center" tone="highlight" className="max-w-[46ch]">
            Connect your calendars and Keeper.sh keeps their busy time aligned. Or read the code first, then
            decide.
          </Text>
          <div className="flex items-center gap-2 mt-2">
            <LinkButton
              to="/register"
              size="compact"
              variant="inverse"
              data-visitors-event={ANALYTICS_EVENTS.marketing_cta_clicked}
              data-visitors-cta="about"
            >
              <ButtonText>Get Started</ButtonText>
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
              <ButtonText>View on GitHub</ButtonText>
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
