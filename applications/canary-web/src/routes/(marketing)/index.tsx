import { useSetAtom } from 'jotai'
import { createFileRoute } from '@tanstack/react-router'
import { canonicalUrl, jsonLdMeta, seoMeta, softwareApplicationSchema } from '../../lib/seo'
import { Heading1, Heading2, Heading3 } from '../../components/ui/primitives/heading'
import { Text } from '../../components/ui/primitives/text'
import {
  MarketingHowItWorksSection,
  MarketingHowItWorksCard,
  MarketingHowItWorksRow,
  MarketingHowItWorksStepBody,
  MarketingHowItWorksStepIllustration,
} from '../../features/marketing/components/marketing-how-it-works'
import { MarketingFaqSection, MarketingFaqList, MarketingFaqItem, MarketingFaqQuestion } from '../../features/marketing/components/marketing-faq'
import { MarketingCtaSection, MarketingCtaCard } from '../../features/marketing/components/marketing-cta'
import { Collapsible } from '../../components/ui/primitives/collapsible'
import { ButtonIcon, ButtonText, ExternalLinkButton, LinkButton } from '../../components/ui/primitives/button'
import { MarketingIllustrationCalendar, MarketingIllustrationCalendarCard, type Skew, type SkewTuple } from '../../features/marketing/components/marketing-illustration-calendar'
import {
  MarketingFeatureBentoBody,
  MarketingFeatureBentoCard,
  MarketingFeatureBentoGrid,
  MarketingFeatureBentoIllustration,
  MarketingFeatureBentoSection,
} from '../../features/marketing/components/marketing-feature-bento'
import { MarketingIllustrationContributors } from '../../illustrations/marketing-illustration-contributors'
import { MarketingIllustrationProviders } from '../../illustrations/marketing-illustration-providers'
import { MarketingIllustrationSync } from '../../illustrations/marketing-illustration-sync'
import { MarketingIllustrationSetup } from '../../illustrations/marketing-illustration-setup'
import { HowItWorksConnect } from '../../illustrations/how-it-works-connect'
import { HowItWorksConfigure } from '../../illustrations/how-it-works-configure'
import { HowItWorksSync } from '../../illustrations/how-it-works-sync'
import {
  MarketingPricingComparisonGrid,
  MarketingPricingComparisonSpacer,
  MarketingPricingFeatureDisplay,
  MarketingPricingFeatureLabel,
  type MarketingPricingFeatureValueKind,
  MarketingPricingFeatureMatrix,
  MarketingPricingFeatureRow,
  MarketingPricingFeatureValue,
  MarketingPricingIntro,
  MarketingPricingPlanCard,
  MarketingPricingSection,
} from '../../features/marketing/components/marketing-pricing-section'
import { calendarEmphasizedAtom } from '../../state/calendar-emphasized'
import ArrowRightIcon from "lucide-react/dist/esm/icons/arrow-right";
import ArrowUpRightIcon from "lucide-react/dist/esm/icons/arrow-up-right";

const createSkew = (rotate: number, x: number, y: number): Skew => ({ rotate, x, y });

const SKEW_BACK_LEFT: SkewTuple = [
  createSkew(-12, -24, 12),
  createSkew(-8, -16, 8),
  createSkew(-3, -8, 4),
]

const SKEW_BACK_RIGHT: SkewTuple = [
  createSkew(9, 20, -8),
  createSkew(5, 12, -4),
  createSkew(1.5, 6, -2),
]

const SKEW_FRONT: SkewTuple = [
  createSkew(-4, 4, -6),
  createSkew(-2, 2, -2),
  createSkew(0, 0, 0),
]

type MarketingFeature = {
  id: number
  title: string
  description: string
  gridClassName: string
  illustration?: React.ReactNode
}

const MARKETING_FEATURES: MarketingFeature[] = [
  {
    id: 1,
    title: 'Privacy-First & Open Source',
    description:
      'Open-source, released under an AGPL-3.0 license. Secure and community driven. Here are some of the latest contributors.',
    gridClassName: 'lg:col-start-1 lg:col-span-4 lg:row-start-1',
    illustration: <MarketingIllustrationContributors />,
  },
  {
    id: 2,
    title: 'Universal Calendar Sync',
    description:
      'Google Calendar, Outlook, Apple Calendar, and more. Automatically sync events between all your calendars no matter the provider.',
    gridClassName: 'lg:col-start-5 lg:col-span-6 lg:row-start-1',
    illustration: <MarketingIllustrationProviders />,
  },
  {
    id: 3,
    title: 'Simple Synchronization Engine',
    description:
      'Your events are aggregated and synced across all linked calendars. Discrepancies are reconciled. Built to prevent orphan events.',
    gridClassName: 'lg:col-start-1 lg:col-span-6 lg:row-start-2',
    illustration: <MarketingIllustrationSync />,
  },
  {
    id: 4,
    title: 'Quick Setup',
    description:
      'Link OAuth, ICS or CalDAV accounts in seconds. No complicated configuration or technical knowledge required. Connect and go.',
    gridClassName: 'lg:col-start-7 lg:col-span-4 lg:row-start-2',
    illustration: <MarketingIllustrationSetup />,
  },
]

type PricingFeature = {
  label: string
  free: MarketingPricingFeatureValueKind
  pro: MarketingPricingFeatureValueKind
}

type PricingPlan = {
  id: string
  name: string
  price: string
  period: string
  description: string
  ctaLabel: string
  tone?: "default" | "inverse"
}

const PRICING_PLANS: PricingPlan[] = [
  {
    id: 'free',
    name: 'Free',
    price: '$0',
    period: 'per month',
    description:
      'For personal use and getting started with calendar sync.',
    ctaLabel: 'Get Started',
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '$5',
    period: 'per month',
    description:
      'For power users who need fast syncs, advanced feed controls, and unlimited syncing.',
    ctaLabel: 'Get Started',
    tone: "inverse" as const,
  },
]

const PRICING_FEATURES: PricingFeature[] = [
  { label: 'Sync Interval', free: 'Every 30 minutes', pro: 'Every 1 minute' },
  { label: 'Linked Accounts', free: 'Up to 2', pro: 'infinity' },
  { label: 'Sync Mappings', free: 'Up to 3', pro: 'infinity' },
  { label: 'Aggregated iCal Feed', free: 'check', pro: 'check' },
  { label: 'iCal Feed Customization', free: 'minus', pro: 'check' },
  { label: 'Event Filters & Exclusions', free: 'minus', pro: 'check' },
  { label: 'API & MCP Access', free: '25 calls/day', pro: 'infinity' },
  { label: 'Priority Support', free: 'minus', pro: 'check' },
]

type HowItWorksStep = {
  title: string
  description: string
}

const HOW_IT_WORKS_STEPS: HowItWorksStep[] = [
  {
    title: 'Connect your calendars',
    description:
      'Link your Google, Outlook, iCloud, or CalDAV accounts using OAuth or ICS feeds. It takes seconds.',
  },
  {
    title: 'Configure sync rules',
    description:
      'Choose which calendars to sync and how events should appear. Keeper handles the rest automatically.',
  },
  {
    title: 'Stay in sync',
    description:
      'Events are continuously aggregated and pushed across all your linked calendars. Conflicts are reconciled.',
  },
]

type FaqItem = {
  question: string
  answer: string
  content?: React.ReactNode
}

const FAQ_ITEMS: FaqItem[] = [
  {
    question: 'Can I use ICS or iCal links as a source?',
    answer:
      'Yes. Any publicly accessible ICS or iCal link can be used as a calendar source in Keeper. This means you can pull events from services that only offer read-only calendar feeds.',
  },
  {
    question: 'Which calendar providers does Keeper.sh support?',
    answer:
      'Keeper.sh works with Google Calendar, Microsoft Outlook, Apple iCloud, FastMail, and any provider that supports CalDAV or ICS feeds. If your calendar supports one of these protocols, it will work with Keeper.',
  },
  {
    question: 'Can I self-host Keeper.sh?',
    answer:
      'Yes. Keeper.sh is open-source under the AGPL-3.0 license. Check the README on GitHub for setup instructions, or use one of the many Docker images we offer for quick deployment.',
    content: <>Yes. Keeper.sh is open-source under the AGPL-3.0 license. Check the <a href="https://github.com/ridafkih/keeper.sh#readme" target="_blank" rel="noreferrer" className="text-foreground underline underline-offset-2">README on GitHub</a> for setup instructions, or use one of the many Docker images we offer for quick deployment.</>,
  },
  {
    question: 'How often do calendars sync?',
    answer:
      'On the free plan, calendars sync every 30 minutes. On the Pro plan, calendars sync every minute.',
  },
  {
    question: 'Are my event details visible to others?',
    answer:
      'Only if you want them to be. You can choose whether events display details, or just show a generic event summary. You can customize the title, and choose to hide the details you want to keep private. These are configurable per-calendar.',
  },
  {
    question: 'Can I control how synced events appear?',
    answer:
      'Yes. You configure how events are displayed on each destination calendar. Titles, descriptions, and other details can be customized or stripped entirely.',
  },
  {
    question: 'Can I cancel my subscription anytime?',
    answer:
      'Yes. You can cancel at any time from your account settings. Your access continues until the end of the current billing period.',
  },
]

export const Route = createFileRoute('/(marketing)/')({
  component: MarketingPage,
  head: () => ({
    links: [{ rel: "canonical", href: canonicalUrl("/") }],
    meta: [
      ...seoMeta({
        title: "Open-Source Calendar Syncing for Google, Outlook & iCloud",
        description:
          "Keep your personal, work, and school calendars in sync automatically. Open-source (AGPL-3.0) calendar syncing for Google Calendar, Outlook, iCloud, FastMail, and CalDAV.",
        path: "/",
        brandPosition: "before",
      }),
      jsonLdMeta(softwareApplicationSchema()),
    ],
  }),
})

function MarketingPage() {
  const setEmphasized = useSetAtom(calendarEmphasizedAtom)

  return (
    <div className="flex flex-col gap-2 pt-8">
      <Heading1 className="text-center">All of your calendars in-sync.</Heading1>
      <Text align="center" className="max-w-[48ch] mx-auto">
        Synchronize events between your personal, work, business and school calendars automatically. Works with Google Calendar, Outlook, iCloud, CalDAV, and ICS/iCal feeds. Open-source under AGPL-3.0.
      </Text>
      <div className="contents *:z-20">
        <div className="flex items-center gap-2 mx-auto pt-1">
          <LinkButton
            to="/register"
            size="compact"
            onMouseEnter={() => setEmphasized(true)}
            onMouseLeave={() => setEmphasized(false)}
          >
            <ButtonText>Sync Calendars</ButtonText>
            <ButtonIcon>
              <ArrowRightIcon size={16} />
            </ButtonIcon>
          </LinkButton>
          <ExternalLinkButton
            href="https://github.com/ridafkih/keeper.sh"
            target="_blank"
            rel="noreferrer"
            size="compact"
            variant="border"
          >
            <ButtonText>View GitHub</ButtonText>
            <ButtonIcon>
              <ArrowUpRightIcon size={16} />
            </ButtonIcon>
          </ExternalLinkButton>
        </div>
      </div>
      <div className="contents *:z-10">
        <div className="flex flex-col">
          <MarketingIllustrationCalendar>
            <MarketingIllustrationCalendarCard skew={SKEW_BACK_LEFT} />
            <MarketingIllustrationCalendarCard skew={SKEW_BACK_RIGHT} />
            <MarketingIllustrationCalendarCard skew={SKEW_FRONT} />
          </MarketingIllustrationCalendar>
          <MarketingFeatureBentoSection id="features">
            <MarketingFeatureBentoGrid>
              {MARKETING_FEATURES.map((feature) => (
                <MarketingFeatureBentoCard key={feature.id} className={feature.gridClassName}>
                  <MarketingFeatureBentoIllustration plain={!!feature.illustration}>
                    {feature.illustration}
                  </MarketingFeatureBentoIllustration>
                  <MarketingFeatureBentoBody>
                    <Heading3 as="h2">{feature.title}</Heading3>
                    <Text size="sm" className="text-left">
                      {feature.description}
                    </Text>
                  </MarketingFeatureBentoBody>
                </MarketingFeatureBentoCard>
              ))}
            </MarketingFeatureBentoGrid>
          </MarketingFeatureBentoSection>

          <MarketingPricingSection id="pricing">
            <MarketingPricingIntro>
              <Heading2 className="text-center">Hosted Pricing</Heading2>
              <Text size='sm' align="center">
                Keeper.sh uses a low-cost freemium model to give you a solid range of choice. Check the GitHub repository for self-hosting options.
              </Text>
            </MarketingPricingIntro>

            <MarketingPricingComparisonGrid>
              <MarketingPricingComparisonSpacer />

              {PRICING_PLANS.map((plan) => (
                <MarketingPricingPlanCard
                  key={plan.id}
                  tone={plan.tone}
                  name={plan.name}
                  price={plan.price}
                  period={plan.period}
                  description={plan.description}
                  ctaLabel={plan.ctaLabel}
                />
              ))}

              <MarketingPricingFeatureMatrix>
                {PRICING_FEATURES.map((feature) => (
                  <MarketingPricingFeatureRow key={feature.label}>
                    <MarketingPricingFeatureLabel>
                      <Text size="sm" className="text-left text-nowrap">{feature.label}</Text>
                    </MarketingPricingFeatureLabel>
                    <MarketingPricingFeatureValue>
                      <MarketingPricingFeatureDisplay value={feature.free} tone="muted" />
                    </MarketingPricingFeatureValue>
                    <MarketingPricingFeatureValue>
                      <MarketingPricingFeatureDisplay value={feature.pro} tone="muted" />
                    </MarketingPricingFeatureValue>
                  </MarketingPricingFeatureRow>
                ))}
              </MarketingPricingFeatureMatrix>
            </MarketingPricingComparisonGrid>
          </MarketingPricingSection>

          <MarketingHowItWorksSection>
            <Heading2 className="text-center">How It Works</Heading2>
            <Text size="sm" align="center" className="mt-2 max-w-[48ch] mx-auto">
              Three steps to keep every calendar on the same page. Connect, configure, and forget about it.
            </Text>
            <MarketingHowItWorksCard>
              <MarketingHowItWorksRow>
                <MarketingHowItWorksStepBody step={1}>
                  <Heading3 as="h3">{HOW_IT_WORKS_STEPS[0].title}</Heading3>
                  <Text size="sm" tone="muted">{HOW_IT_WORKS_STEPS[0].description}</Text>
                </MarketingHowItWorksStepBody>
                <MarketingHowItWorksStepIllustration align="right">
                  <HowItWorksConnect />
                </MarketingHowItWorksStepIllustration>
              </MarketingHowItWorksRow>

              <MarketingHowItWorksRow reverse>
                <MarketingHowItWorksStepBody step={2}>
                  <Heading3 as="h3">{HOW_IT_WORKS_STEPS[1].title}</Heading3>
                  <Text size="sm" tone="muted">{HOW_IT_WORKS_STEPS[1].description}</Text>
                </MarketingHowItWorksStepBody>
                <MarketingHowItWorksStepIllustration align="left">
                  <HowItWorksConfigure />
                </MarketingHowItWorksStepIllustration>
              </MarketingHowItWorksRow>

              <MarketingHowItWorksRow>
                <MarketingHowItWorksStepBody step={3}>
                  <Heading3 as="h3">{HOW_IT_WORKS_STEPS[2].title}</Heading3>
                  <Text size="sm" tone="muted">{HOW_IT_WORKS_STEPS[2].description}</Text>
                </MarketingHowItWorksStepBody>
                <MarketingHowItWorksStepIllustration align="right">
                  <HowItWorksSync />
                </MarketingHowItWorksStepIllustration>
              </MarketingHowItWorksRow>
            </MarketingHowItWorksCard>
          </MarketingHowItWorksSection>

          <MarketingFaqSection>
            <Heading2 className="text-center">Frequently Asked Questions</Heading2>
            <Text size="sm" align="center" className="mt-2 max-w-[48ch] mx-auto">
              Everything you need to know about Keeper.sh. Can't find what you're looking for? Reach out at{' '}
              <a href="mailto:support@keeper.sh" className="text-foreground underline underline-offset-2">support@keeper.sh</a>.
            </Text>
            <MarketingFaqList>
              {FAQ_ITEMS.map((item) => (
                <MarketingFaqItem key={item.question}>
                  <Collapsible
                    trigger={<MarketingFaqQuestion>{item.question}</MarketingFaqQuestion>}
                  >
                    <Text size="sm" tone="muted">{item.content ?? item.answer}</Text>
                  </Collapsible>
                </MarketingFaqItem>
              ))}
            </MarketingFaqList>
          </MarketingFaqSection>

          <MarketingCtaSection>
            <MarketingCtaCard>
              <Heading2 className="text-center text-white">Ready to sync your calendars?</Heading2>
              <Text size="sm" align="center" tone="highlight" className="max-w-[46ch]">
                Start syncing your calendars in seconds. Free to use, no credit card required.
              </Text>
              <div className="flex items-center gap-2 mt-2">
                <LinkButton to="/register" size="compact" variant="inverse">
                  <ButtonText>Get Started</ButtonText>
                  <ButtonIcon>
                    <ArrowRightIcon size={16} />
                  </ButtonIcon>
                </LinkButton>
                <ExternalLinkButton
                  href="https://github.com/ridafkih/keeper.sh"
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
      </div>
    </div>
  )
}
