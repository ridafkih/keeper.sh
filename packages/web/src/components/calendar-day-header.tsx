import type { FC } from "react";
import { tv } from "tailwind-variants";
import { isToday, formatWeekday } from "@/utils/calendar";
import { TextMeta } from "@/components/typography";

const calendarDayNumber = tv({
  base: "text-lg font-semibold",
  variants: {
    today: {
      true: "bg-primary text-primary-foreground w-8 h-8 rounded-full flex items-center justify-center",
      false: "text-foreground",
    },
  },
});

interface CalendarDayHeaderProps {
  date: Date;
}

export const CalendarDayHeader: FC<CalendarDayHeaderProps> = ({ date }) => {
  const today = isToday(date);
  const weekday = formatWeekday(date);
  const dayNumber = date.getDate();

  return (
    <div className="flex flex-col items-center justify-center min-w-24 py-2 border-l border-border">
      <TextMeta>{weekday}</TextMeta>
      <span className={calendarDayNumber({ today })}>{dayNumber}</span>
    </div>
  );
};
