import { useSetAtom } from 'jotai'
import { createFileRoute } from '@tanstack/react-router'
import { Heading1, Heading2 } from '../../components/ui/heading'
import { Text } from '../../components/ui/text'
import { Button, ButtonIcon, ButtonText } from '../../components/ui/button'
import { MarketingIllustrationCalendar, MarketingIllustrationCalendarCard, Skew, SkewTuple } from '../../components/marketing/marketing-illustration-calendar'
import {
  MarketingFeatureBentoBody,
  MarketingFeatureBentoCard,
  MarketingFeatureBentoGrid,
  MarketingFeatureBentoIllustration,
  MarketingFeatureBentoSection,
} from '../../components/marketing/marketing-feature-bento'
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
      'Your events are aggregated, and computed against the destination. Discrepencies are reconciled. Built to prevent orphan events.',
    gridClassName: 'lg:col-start-1 lg:col-span-6 lg:row-start-2',
  },
  {
    id: 4,
    title: 'Quick Setup',
    description:
      'Source from OAuth connections, ICS links or CalDAV. Quick and simple to set up.',
    gridClassName: 'lg:col-start-7 lg:col-span-4 lg:row-start-2',
  },
]

export const Route = createFileRoute('/(marketing)/')({
  component: RouteComponent,
})

function RouteComponent() {
  const setEmphasized = useSetAtom(calendarEmphasizedAtom)

  return (
    <div className="flex flex-col gap-2 pt-8">
      <Heading1 className="text-center">All of your calendars in-sync.</Heading1>
      <Text className="max-w-[42ch] mx-auto">
        Synchronize events between your personal, work, business and school calendars. Open-source under AGPL-3.0.
      </Text>
      <div className="contents *:z-20">
        <div className="flex items-center gap-2 mx-auto">
          <Button
            size="compact"
            onMouseEnter={() => setEmphasized(true)}
            onMouseLeave={() => setEmphasized(false)}
          >
            <ButtonText>Sync Calendars</ButtonText>
            <ButtonIcon>
              <ArrowRightIcon size={16} />
            </ButtonIcon>
          </Button>
          <Button size="compact" variant="border">
            <ButtonText>View GitHub</ButtonText>
            <ButtonIcon>
              <ArrowUpRightIcon size={16} />
            </ButtonIcon>
          </Button>
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
                    <Heading2>{feature.title}</Heading2>
                    <Text size="sm" className="text-left">
                      {feature.description}
                    </Text>
                  </MarketingFeatureBentoBody>
                </MarketingFeatureBentoCard>
              ))}
            </MarketingFeatureBentoGrid>
          </MarketingFeatureBentoSection>
        </div>
      </div>
    </div>
  )
}
