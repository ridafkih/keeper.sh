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
  "Keeper.sh stops your calendars double-booking each other. Rida F'kih built it for his own four calendars, and still writes and maintains it.";

const PERSON_DESCRIPTION =
  "Rida F'kih writes and maintains Keeper.sh, which copies your events between Google Calendar, Outlook, iCloud, and Fastmail so they all show you as busy at the same times. He writes the posts on its blog.";

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
        "Who builds Keeper.sh, the calendar sync service that stops double-booking, why it exists, and why anyone can read its code.",
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
        <Section title="Who builds Keeper.sh">
          <Text size="sm">
            Rida F&apos;kih writes and maintains Keeper.sh, and holds the copyright on it. The sync code, the
            API, the MCP server and this website all live in one public repository. You can read every
            change as it lands.
          </Text>
          <Text size="sm">
            He also writes the posts on the{" "}
            <TextLink align="left" size="sm" to="/blog" tone="default">blog</TextLink>
            , where the comparisons and the provider guides live. You can find him on{" "}
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

        <Section title="Why Keeper.sh exists">
          <Text size="sm">
            It started with four calendars: two on Google, one on Fastmail and one on iCloud. Anyone trying
            to book time saw a different, incomplete week. Meetings kept landing on top of each other.
          </Text>
          <Text size="sm">
            The tools that already existed charged more the more calendars you had, and none of them read
            Fastmail. They also copied the event contents across. Keeper.sh does the smaller job: block the
            same time everywhere, and keep the details private until you turn them on.
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

        <Section title="Why anyone can read the code">
          <Text size="sm">
            Keeper.sh has to read your whole events to work out when you are busy. You should be able to
            check what it does with them, so the code is public and licensed under{" "}
            <ExternalTextLink align="left" href={LICENSE_URL} rel="noopener noreferrer" size="sm" target="_blank" tone="default">
              AGPL-3.0
            </ExternalTextLink>
            . The hosted service at keeper.sh runs the same code that is in the repository.
          </Text>
          <Text size="sm">
            AGPL was chosen because this software normally runs as a service. Anyone who runs a changed
            version has to publish their changes under the same licence. Improvements stay in the open.
          </Text>
          <Text size="sm">
            Every account on a self-hosted instance gets every paid sync feature, with no plan limits.
            Paying for the{" "}
            <TextLink align="left" size="sm" to="/pricing" tone="default">hosted version</TextLink>
            {" "}buys you the server, the upgrades and the backups. It funds the work on both.
          </Text>
        </Section>

        <Section title="How to report a bug or ask a question">
          <Text size="sm">
            File bugs and feature requests as{" "}
            <ExternalTextLink align="left" href={`${REPOSITORY_URL}/issues`} rel="noopener noreferrer" size="sm" target="_blank" tone="default">
              issues on GitHub
            </ExternalTextLink>
            . They are triaged in public. For anything else, email{" "}
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
            Connect your calendars and they all show you as busy at the same times. Or read the code first.
          </Text>
          <div className="flex items-center gap-2 mt-2">
            <LinkButton
              to="/register"
              size="compact"
              variant="inverse"
              data-visitors-event={ANALYTICS_EVENTS.marketing_cta_clicked}
              data-visitors-cta="about"
            >
              <ButtonText>Sync Calendars</ButtonText>
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
