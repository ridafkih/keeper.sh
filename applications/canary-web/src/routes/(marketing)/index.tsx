import { useSetAtom } from 'jotai'
import { createFileRoute } from '@tanstack/react-router'
import { Heading1, Heading2, Heading3 } from '../../components/ui/heading'
import { Text } from '../../components/ui/text'
import { ButtonIcon, ButtonText, ExternalLinkButton, LinkButton } from '../../components/ui/button'
import { MarketingIllustrationCalendar, MarketingIllustrationCalendarCard, type Skew, type SkewTuple } from '../../components/marketing/marketing-illustration-calendar'
import {
  MarketingFeatureBentoBody,
  MarketingFeatureBentoCard,
  MarketingFeatureBentoGrid,
  MarketingFeatureBentoIllustration,
  MarketingFeatureBentoSection,
} from '../../components/marketing/marketing-feature-bento'
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
} from '../../components/marketing/marketing-pricing-section'
import { calendarEmphasizedAtom } from '../../state/calendar-emphasized'
import { ArrowRightIcon, ArrowUpRightIcon } from 'lucide-react'

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
}

const MARKETING_FEATURES: MarketingFeature[] = [
  {
    id: 1,
    title: 'Privacy-First & Open Source',
    description:
      'Open-source, released under an AGPL-3.0 license. Secure and community driven.',
    gridClassName: 'lg:col-start-1 lg:col-span-4 lg:row-start-1',
  },
  {
    id: 2,
    title: 'Universal Calendar Sync',
    description:
      'Google Calendar, Outlook, Apple Calendar, and more. Automatically sync events between your all your calendars no matter the provider.',
    gridClassName: 'lg:col-start-5 lg:col-span-6 lg:row-start-1',
  },
  {
    id: 3,
    title: 'Simple Synchronization Engine',
    description:
      'Your events are aggregated and synced across all linked calendars. Discrepancies are reconciled. Built to prevent orphan events.',
    gridClassName: 'lg:col-start-1 lg:col-span-6 lg:row-start-2',
  },
  {
    id: 4,
    title: 'Quick Setup',
    description:
      'Link OAuth, ICS or CalDAV accounts in seconds. Quick and simple to set up.',
    gridClassName: 'lg:col-start-7 lg:col-span-4 lg:row-start-2',
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
      'For users that just want to get basic calendar syncing up and running.',
    ctaLabel: 'Get Started',
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '$5',
    period: 'per month',
    description:
      'For power users who want minutely syncs and unlimited calendars.',
    ctaLabel: 'Start Free Trial',
    tone: "inverse" as const,
  },
]

const PRICING_FEATURES: PricingFeature[] = [
  { label: 'Sync Interval', free: 'Every 30 minutes', pro: 'Every 1 minute' },
  { label: 'Linked Calendar Accounts', free: '0-2', pro: 'infinity' },
  { label: 'Calendars per Account', free: '0-2', pro: 'infinity' },
  { label: 'Aggregated iCal Link', free: 'check', pro: 'check' },
  { label: 'Priority Support', free: 'minus', pro: 'check' },
]

export const Route = createFileRoute('/(marketing)/')({
  component: MarketingPage,
})

function MarketingPage() {
  const setEmphasized = useSetAtom(calendarEmphasizedAtom)

  return (
    <div className="flex flex-col gap-2 pt-8">
      <Heading1 className="text-center">All of your calendars in-sync.</Heading1>
      <Text align="center" className="max-w-[42ch] mx-auto">
        Synchronize events between your personal, work, business and school calendars. Open-source under AGPL-3.0.
      </Text>
      <div className="contents *:z-20">
        <div className="flex items-center gap-2 mx-auto">
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
            href="https://github.com"
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
          <MarketingFeatureBentoSection>
            <MarketingFeatureBentoGrid>
              {MARKETING_FEATURES.map((feature) => (
                <MarketingFeatureBentoCard key={feature.id} className={feature.gridClassName}>
                  <MarketingFeatureBentoIllustration />
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

          <MarketingPricingSection>
            <MarketingPricingIntro>
              <Heading2 className="text-center">Hosted Pricing</Heading2>
              <Text size='sm' align="center">
                Keeper uses a low-cost freemium model to give you a solid range of choice. Check the GitHub repository for self-hosting options.
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
        </div>
      </div>
    </div>
  )
}
