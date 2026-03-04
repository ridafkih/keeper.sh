import { atom, useAtomValue, useSetAtom } from "jotai";
import { tv } from "tailwind-variants/lite";
import { Text } from "../ui/text";

interface EventBlock {
  startHour: number;
  endHour: number;
  dayOffset: number;
}

const MOCK_EVENTS: EventBlock[] = [
  { startHour: 10, endHour: 11.5, dayOffset: -7 },
  { startHour: 14, endHour: 15, dayOffset: -6 },
  { startHour: 9, endHour: 10, dayOffset: -6 },
  { startHour: 11, endHour: 13, dayOffset: -5 },
  { startHour: 15, endHour: 17, dayOffset: -5 },
  { startHour: 9, endHour: 10.5, dayOffset: -4 },
  { startHour: 13, endHour: 14.5, dayOffset: -4 },
  { startHour: 15, endHour: 16, dayOffset: -4 },
  { startHour: 10, endHour: 12, dayOffset: -3 },
  { startHour: 8, endHour: 9, dayOffset: -2 },
  { startHour: 11, endHour: 13, dayOffset: -2 },
  { startHour: 14, endHour: 15.5, dayOffset: -2 },
  { startHour: 9, endHour: 11, dayOffset: -1 },
  { startHour: 14, endHour: 16, dayOffset: -1 },
  { startHour: 9, endHour: 10.5, dayOffset: 0 },
  { startHour: 13, endHour: 14, dayOffset: 0 },
  { startHour: 15, endHour: 16.5, dayOffset: 0 },
  { startHour: 10, endHour: 12, dayOffset: 1 },
  { startHour: 14, endHour: 15, dayOffset: 1 },
  { startHour: 8, endHour: 9.5, dayOffset: 2 },
  { startHour: 11, endHour: 13, dayOffset: 2 },
  { startHour: 15, endHour: 17, dayOffset: 2 },
  { startHour: 16, endHour: 17.5, dayOffset: 2 },
  { startHour: 9, endHour: 10, dayOffset: 3 },
  { startHour: 10, endHour: 11.5, dayOffset: 4 },
  { startHour: 13, endHour: 14.5, dayOffset: 4 },
  { startHour: 15, endHour: 16, dayOffset: 4 },
  { startHour: 9, endHour: 11, dayOffset: 5 },
  { startHour: 14, endHour: 16, dayOffset: 5 },
  { startHour: 10, endHour: 12.5, dayOffset: 6 },
  { startHour: 8, endHour: 9, dayOffset: 7 },
  { startHour: 11, endHour: 13, dayOffset: 7 },
];

const DAYS_BEFORE = 7;
const DAYS_AFTER = 7;
const TOTAL_DAYS = DAYS_BEFORE + 1 + DAYS_AFTER;
const GRAPH_HEIGHT = 96;
const MIN_BAR_PERCENT = 5;

const graphBar = tv({
  base: "flex-1 rounded-[0.625rem]",
  variants: {
    period: {
      past: "bg-neutral-100 border border-neutral-200",
      today: "bg-emerald-400 border-transparent",
      future: "bg-emerald-400 border-emerald-500 bg-[repeating-linear-gradient(-45deg,_transparent_0_4px,_var(--color-illustration-stripe)_4px_6px)]",
    },
  },
});

type Period = "past" | "today" | "future";

const resolvePeriod = (dayOffset: number): Period => {
  if (dayOffset < 0) return "past";
  if (dayOffset === 0) return "today";
  return "future";
};

const pluralize = (count: number, singular: string) =>
  count === 1 ? `${count} ${singular}` : `${count} ${singular}s`;

const formatSummary = (count: number, dateLabel: string) =>
  `${pluralize(count, "event")} · ${dateLabel}`;

const buildDays = (events: EventBlock[]) => {
  const counts = new Array<number>(TOTAL_DAYS).fill(0);
  for (const event of events) {
    const index = event.dayOffset + DAYS_BEFORE;
    if (index >= 0 && index < TOTAL_DAYS) counts[index]++;
  }

  const max = Math.max(...counts, 1);

  return counts.map((count, index) => {
    const dayOffset = index - DAYS_BEFORE;
    const date = new Date();
    date.setDate(date.getDate() + dayOffset);

    const fullLabel = date.toLocaleDateString("en-US", {
      weekday: "long",
      month: "short",
      day: "numeric",
    });

    const period = resolvePeriod(dayOffset);

    return {
      count,
      dayOffset,
      heightPercent: count === 0 ? MIN_BAR_PERCENT : (count / max) * 100,
      label: String(dayOffset),
      fullLabel,
      period,
    };
  });
};

const hoverIndexAtom = atom<number | null>(null);

function EventGraphSummary({ days }: { days: ReturnType<typeof buildDays> }) {
  const hoverIndex = useAtomValue(hoverIndexAtom);
  const today = days[DAYS_BEFORE];
  const activeDay = hoverIndex !== null ? days[hoverIndex] : today;

  return (
    <Text size="sm" tone="muted" className="tabular-nums text-right">
      {formatSummary(activeDay.count, activeDay.fullLabel)}
    </Text>
  );
}

export function EventGraph() {
  const days = buildDays(MOCK_EVENTS);
  const setHoverIndex = useSetAtom(hoverIndexAtom);

  return (
    <div className="flex flex-col gap-6">
      <EventGraphSummary days={days} />

      <div
        className="flex gap-0.5 [&:hover>*]:opacity-50 [&>*:hover]:opacity-100"
        onPointerLeave={() => setHoverIndex(null)}
      >
        {days.map((day, index) => (
          <div
            key={day.dayOffset}
            className="flex-1 flex flex-col gap-2"
            onPointerEnter={() => setHoverIndex(index)}
          >
            <div
              className="flex items-end"
              style={{ height: GRAPH_HEIGHT }}
            >
              <div
                className={graphBar({ period: day.period, className: "w-full" })}
                style={{ height: `${day.heightPercent}%` }}
              />
            </div>
            <Text
              size="xs"
              tone="default"
              align="center"
              className="font-mono leading-none select-none"
            >
              {day.label}
            </Text>
          </div>
        ))}
      </div>
    </div>
  );
}
