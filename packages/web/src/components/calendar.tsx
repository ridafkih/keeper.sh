"use client";

import type { RefCallback } from "react";
import type { CalendarEvent } from "@/hooks/use-events";
import { tv } from "tailwind-variants";
import {
  getDaysFromDate,
  isSameDay,
  formatTime,
  formatDayHeading,
  getColorFromUrl,
} from "@/utils/calendar";
import { TextBody } from "@/components/typography";

const agendaEventDot = tv({
  base: "size-1.5 rounded-full shrink-0",
  variants: {
    color: {
      blue: "bg-blue-500",
      green: "bg-green-500",
      purple: "bg-purple-500",
      orange: "bg-orange-500",
    },
  },
  defaultVariants: {
    color: "blue",
  },
});

const skeletonBar = tv({ base: "bg-surface-skeleton rounded animate-pulse" });

const SkeletonBar = ({ className }: { className?: string }) => (
  <div className={skeletonBar({ className })} />
);

const SkeletonEventItem = () => (
  <li className="flex items-center gap-2 py-1 text-sm text-foreground-muted">
    <SkeletonBar className="w-1.5 h-1.5 rounded-full shrink-0" />
    <SkeletonBar className="h-4 w-64" />
  </li>
);

const SkeletonDaySection = ({ index }: { index: number }) => {
  const eventCount = (index % 3) + 1;
  return (
    <section className="flex flex-col gap-2">
      <div className="border-b border-border pb-2">
        <SkeletonBar className="h-6 w-48" />
      </div>
      <ul className="flex flex-col list-none p-0 m-0">
        {Array.from({ length: eventCount }).map((_, eventIndex) => (
          <SkeletonEventItem key={eventIndex} />
        ))}
      </ul>
    </section>
  );
};

export const CalendarSkeleton = ({ days = 7 }: { days?: number }) => (
  <div className="flex flex-col gap-6 max-w-2xl">
    {Array.from({ length: days }).map((_, dayIndex) => (
      <SkeletonDaySection key={dayIndex} index={dayIndex} />
    ))}
  </div>
);

interface CalendarProps {
  events?: CalendarEvent[];
  startDate?: Date;
  daysToShow?: number;
  isLoadingMore?: boolean;
  lastSectionRef?: RefCallback<HTMLElement>;
}

const DayEventList = ({ events }: { events: CalendarEvent[] }) => {
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
                <span className="text-foreground font-medium">
                  {event.sourceName}
                </span>
              </>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
};

const LoadingIndicator = () => (
  <div className="py-4 text-center">
    <TextBody>Loading more events...</TextBody>
  </div>
);

export const Calendar = ({
  events = [],
  startDate = new Date(),
  daysToShow = 7,
  isLoadingMore = false,
  lastSectionRef,
}: CalendarProps) => {
  const normalizedStartDate = new Date(startDate);
  normalizedStartDate.setHours(0, 0, 0, 0);

  const days = getDaysFromDate(normalizedStartDate, daysToShow);

  const getEventsForDay = (date: Date): CalendarEvent[] => {
    return events
      .filter((event) => isSameDay(new Date(event.startTime), date))
      .sort(
        (a, b) =>
          new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
      );
  };

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      {days.map((date, index) => {
        const isLast = index === days.length - 1;
        return (
          <section
            key={date.toISOString()}
            ref={isLast ? lastSectionRef : undefined}
            className="flex flex-col gap-2"
          >
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
