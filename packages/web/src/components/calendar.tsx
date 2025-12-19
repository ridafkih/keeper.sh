"use client";

import {
  getDaysFromDate,
  isSameDay,
  formatTime,
  formatDayHeading,
} from "@/utils/calendar";
import {
  agendaContainer,
  agendaDaySection,
  agendaDayHeading as agendaDayHeadingStyle,
  agendaEventList,
  agendaEventItem,
  agendaEventTime,
  agendaEventDot,
  agendaEventSource,
  agendaEmptyDay,
} from "@/styles";

export interface CalendarEvent {
  id: string;
  startTime: Date;
  endTime: Date;
  calendarId?: string;
  sourceName?: string;
}

export interface CalendarProps {
  events?: CalendarEvent[];
  startDate?: Date;
  daysToShow?: number;
}

type EventColor = "blue" | "green" | "purple" | "orange";

const CALENDAR_COLORS: EventColor[] = ["blue", "green", "purple", "orange"];

const getEventColor = (calendarId?: string): EventColor => {
  if (!calendarId) return "blue";
  const hash = calendarId.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return CALENDAR_COLORS[hash % CALENDAR_COLORS.length] ?? "blue";
};

const DayEventList = ({ events }: { events: CalendarEvent[] }) => {
  if (events.length === 0) {
    return <p className={agendaEmptyDay()}>No events</p>;
  }

  return (
    <ul className={agendaEventList()}>
      {events.map((event) => (
        <li key={event.id} className={agendaEventItem()}>
          <span className={agendaEventDot({ color: getEventColor(event.calendarId) })} />
          <span>
            Busy from{" "}
            <span className={agendaEventTime()}>
              {formatTime(new Date(event.startTime))}
            </span>
            {" "}to{" "}
            <span className={agendaEventTime()}>
              {formatTime(new Date(event.endTime))}
            </span>
            {event.sourceName && (
              <>
                {" "}according to an event from{" "}
                <span className={agendaEventSource()}>{event.sourceName}</span>
              </>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
};

export const Calendar = ({
  events = [],
  startDate = new Date(),
  daysToShow = 14,
}: CalendarProps) => {
  const normalizedStartDate = new Date(startDate);
  normalizedStartDate.setHours(0, 0, 0, 0);

  const days = getDaysFromDate(normalizedStartDate, daysToShow);

  const getEventsForDay = (date: Date): CalendarEvent[] => {
    return events
      .filter((event) => isSameDay(new Date(event.startTime), date))
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  };

  return (
    <div className={agendaContainer()}>
      {days.map((date) => (
        <section key={date.toISOString()} className={agendaDaySection()}>
          <h2 className={agendaDayHeadingStyle()}>{formatDayHeading(date)}</h2>
          <DayEventList events={getEventsForDay(date)} />
        </section>
      ))}
    </div>
  );
};
