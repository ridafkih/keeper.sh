import type { FC } from "react"
import { HeroTitle } from "@/components/hero-title"
import { HeroCopy } from "@/components/hero-copy"
import { FlexColumnGroup } from "@/components/flex-column-group"
import { FlexRowGroup } from "@/components/flex-row-group"
import { LinkButton } from "@/components/button"
import { ArrowRight, ArrowUpRight } from "lucide-react"
import { HeroSection } from "@/compositions/hero-section/hero-section"
import { CalendarStack } from "@/compositions/calendar-illustration/components/calendar-stack"
import { Calendar } from "@/compositions/calendar-illustration/components/calendar"
import { CalendarIllustrationButton } from "@/compositions/calendar-illustration/components/calendar-illustration-button"
import { createBackLeftSkew, createBackRightSkew, createFrontSkew } from "@/compositions/calendar-illustration/utils/stack"
import type { EventRecord } from "@/compositions/calendar-illustration/utils/events"
import { MarketingConnectCalendars } from "@/compositions/marketing-connect-calendars/marketing-connect-calendars"
import { MarketingHowItWorks } from "@/compositions/marketing-how-it-works/marketing-how-it-works"

const BACK_LEFT_EVENTS: EventRecord = {
  0: [2, 9, 16, 23],
  30: [5, 12, 19, 26],
  60: [7, 14, 21, 28],
}

const BACK_RIGHT_EVENTS: EventRecord = {
  200: [3, 10, 17, 24],
  230: [6, 13, 20, 27],
  260: [1, 8, 15, 22, 29],
}

const FRONT_EVENTS: EventRecord = {
  250: [1, 2, 3, 4, 7, 8, 27, 28, 29, 30],
  140: [2, 9, 16, 23, 30, 4, 11, 18, 25, 6, 13, 20, 27],
  320: [3, 10, 17, 24, 31, 5, 12, 19, 26],
  11: [1, 8, 15, 22, 29, 2, 9, 16, 23, 30],
}

const LandingPage: FC = () => {
  return (
    <>
      <main>
        <FlexColumnGroup>
          <HeroSection>
            <FlexColumnGroup className="pt-32 pb-4 gap-2">
              <HeroTitle className="text-center">All of your calendars in-sync.</HeroTitle>
              <HeroCopy className="text-center">Synchronize events between your personal, work, business and school calendars. Open-source under AGPL-3.0.</HeroCopy>
              <FlexRowGroup className="gap-1 my-2 justify-center">
                <CalendarIllustrationButton href="/register">
                  <span>Sync Calendars</span>
                  <ArrowRight size={15} />
                </CalendarIllustrationButton>
                <LinkButton href="https://github.com" variant="border" size="compact">
                  <span>View GitHub</span>
                  <ArrowUpRight size={15} />
                </LinkButton>
              </FlexRowGroup>
            </FlexColumnGroup>
            <div className="py-4 px-8 w-full">
              <CalendarStack>
                <Calendar skew={createBackLeftSkew(1)} events={BACK_LEFT_EVENTS} />
                <Calendar skew={createBackRightSkew(1)} events={BACK_RIGHT_EVENTS} />
                <Calendar skew={createFrontSkew(1)} events={FRONT_EVENTS} className="z-10" />
              </CalendarStack>
            </div>
          </HeroSection>
          <FlexColumnGroup className="py-6 gap-6">
            <MarketingConnectCalendars />
            <MarketingHowItWorks />
          </FlexColumnGroup>
        </FlexColumnGroup>
      </main>
    </>
  )
}

export default LandingPage;
