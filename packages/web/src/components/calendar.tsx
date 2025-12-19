"use client";

import { getDaysFromDate } from "@/utils/calendar";
import {
  agendaContainer,
  agendaDaySection,
  agendaDayHeading,
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

function getEventColor(calendarId?: string): EventColor {
  if (!calendarId) return "blue";
  const hash = calendarId.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return CALENDAR_COLORS[hash % CALENDAR_COLORS.length] ?? "blue";
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatDayHeading(date: Date): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (isSameDay(date, today)) {
    return "Today";
  }

  if (isSameDay(date, tomorrow)) {
    return "Tomorrow";
  }

  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export function Calendar({
  events = [],
  startDate = new Date(),
  daysToShow = 14,
}: CalendarProps) {
  const normalizedStartDate = new Date(startDate);
  normalizedStartDate.setHours(0, 0, 0, 0);

  const days = getDaysFromDate(normalizedStartDate, daysToShow);

  function getEventsForDay(date: Date): CalendarEvent[] {
    return events
      .filter((event) => isSameDay(new Date(event.startTime), date))
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  }

  return (
    <div className={agendaContainer()}>
      {days.map((date) => {
        const dayEvents = getEventsForDay(date);

        return (
          <section key={date.toISOString()} className={agendaDaySection()}>
            <h2 className={agendaDayHeading()}>{formatDayHeading(date)}</h2>

            {dayEvents.length > 0 ? (
              <ul className={agendaEventList()}>
                {dayEvents.map((event) => (
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
            ) : (
              <p className={agendaEmptyDay()}>No events</p>
            )}
          </section>
        );
      })}
    </div>
  );
}
