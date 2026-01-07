"use client";

import type { RefCallback } from "react";
import type { CalendarEvent } from "@/hooks/use-events";
import { tv } from "tailwind-variants";
import {
  formatDayHeading,
  formatTime,
  getColorFromUrl,
  getDaysFromDate,
  isSameDay,
} from "@/utils/calendar";
import { TextBody } from "@/components/typography";

const agendaEventDot = tv({
  base: "size-1.5 rounded-full shrink-0",
  defaultVariants: {
    color: "blue",
  },
  variants: {
    color: {
      blue: "bg-blue-500",
      green: "bg-green-500",
      orange: "bg-orange-500",
      purple: "bg-purple-500",
    },
  },
});

const skeletonBar = tv({ base: "bg-surface-skeleton rounded animate-pulse" });

import type { ReactNode } from "react";

const SkeletonBar = ({ className }: { className?: string }): ReactNode => (
  <div className={skeletonBar({ className })} />
);

const SkeletonEventItem = (): ReactNode => (
  <li className="flex items-center gap-2 py-1 text-sm text-foreground-muted">
    <SkeletonBar className="w-1.5 h-1.5 rounded-full shrink-0" />
    <SkeletonBar className="h-4 w-64" />
  </li>
);

const SkeletonDaySection = ({ index }: { index: number }): ReactNode => {
  const eventCount = (index % 3) + 1;
  const eventItems: ReactNode[] = [];
  for (let eventIndex = 0; eventIndex < eventCount; eventIndex++) {
    eventItems.push(<SkeletonEventItem key={eventIndex} />);
  }
  return (
    <section className="flex flex-col gap-2">
      <div className="border-b border-border pb-2">
        <SkeletonBar className="h-6 w-48" />
      </div>
      <ul className="flex flex-col list-none p-0 m-0">{eventItems}</ul>
    </section>
  );
};

const CalendarSkeleton = ({ days = 7 }: { days?: number }): ReactNode => {
  const daySections: ReactNode[] = [];
  for (let dayIndex = 0; dayIndex < days; dayIndex++) {
    daySections.push(<SkeletonDaySection key={dayIndex} index={dayIndex} />);
  }
  return <div className="flex flex-col gap-6 max-w-2xl">{daySections}</div>;
};

interface CalendarProps {
  events?: CalendarEvent[];
  startDate?: Date;
  daysToShow?: number;
  isLoadingMore?: boolean;
  lastSectionRef?: RefCallback<HTMLElement>;
}

const DayEventList = ({ events }: { events: CalendarEvent[] }): ReactNode => {
  if (events.length === 0) {
    return <p className="text-sm text-foreground-subtle py-2">No events</p>;
  }

  return (
    <ul className="flex flex-col list-none p-0 m-0">
      {events.map((event) => (
        <li
          key={event.id}
          className="flex items-center gap-2 py-1 text-sm text-foreground-muted tracking-tight"
        >
          <span
            className={agendaEventDot({
              color: getColorFromUrl(event.sourceUrl),
            })}
          />
          <span>
            Busy from{" "}
            <span className="tabular-nums text-foreground font-medium">
              {formatTime(new Date(event.startTime))}
            </span>{" "}
            to{" "}
            <span className="tabular-nums text-foreground font-medium">
              {formatTime(new Date(event.endTime))}
            </span>
            {event.sourceName && (
              <>
                {" "}
                according to an event from{" "}
                <span className="text-foreground font-medium">{event.sourceName}</span>
              </>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
};

const LoadingIndicator = (): ReactNode => (
  <div className="py-4 text-center">
    <TextBody>Loading more events...</TextBody>
  </div>
);

const Calendar = ({
  events = [],
  startDate = new Date(),
  daysToShow = 7,
  isLoadingMore = false,
  lastSectionRef,
}: CalendarProps): ReactNode => {
  const normalizedStartDate = new Date(startDate);
  normalizedStartDate.setHours(0, 0, 0, 0);

  const days = getDaysFromDate(normalizedStartDate, daysToShow);

  const getEventsForDay = (date: Date): CalendarEvent[] =>
    events
      .filter((event) => isSameDay(new Date(event.startTime), date))
      .sort((first, second) => new Date(first.startTime).getTime() - new Date(second.startTime).getTime());

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      {days.map((date, index) => {
        const isLast = index === days.length - 1;
        const getSectionRef = (): typeof lastSectionRef | null => {
          if (isLast) {
            return lastSectionRef;
          }
          return null;
        };
        const sectionRef = getSectionRef();
        return (
          <section key={date.toISOString()} ref={sectionRef} className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold text-foreground border-b border-border pb-2">
              {formatDayHeading(date)}
            </h2>
            <DayEventList events={getEventsForDay(date)} />
          </section>
        );
      })}
      {isLoadingMore && <LoadingIndicator />}
    </div>
  );
};

export { CalendarSkeleton, Calendar };
