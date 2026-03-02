import { useSetAtom } from 'jotai'
import { createFileRoute } from '@tanstack/react-router'
import { Heading1 } from '../../components/ui/heading'
import { Text } from '../../components/ui/text'
import { Button, ButtonIcon, ButtonText } from '../../components/ui/button'
import { MarketingIllustrationCalendar, MarketingIllustrationCalendarCard, Skew, SkewTuple } from '../../components/marketing/marketing-illustration-calendar'
import { calendarEmphasizedAtom } from '../../state/calendar-emphasized'
import { ArrowRightIcon } from 'lucide-react'

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
              <ArrowRightIcon size={16} />
            </ButtonIcon>
          </Button>
        </div>
      </div>
      <div className="contents *:z-10">
        <MarketingIllustrationCalendar>
          <MarketingIllustrationCalendarCard skew={SKEW_BACK_LEFT} />
          <MarketingIllustrationCalendarCard skew={SKEW_BACK_RIGHT} />
          <MarketingIllustrationCalendarCard skew={SKEW_FRONT} />
        </MarketingIllustrationCalendar>
      </div>
    </div>
  )
}
