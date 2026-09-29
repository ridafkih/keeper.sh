import { useCallback, useRef, useState, type ReactNode } from "react";
import type { SyncCalendarRole, SyncCalendars, SyncMode } from "@keeper.sh/data-schemas";
import { SegmentedControl } from "@/components/ui/primitives/segmented-control";
import { Text } from "@/components/ui/primitives/text";
import type { CalendarSource } from "@/types/api";
import { cn } from "@/utils/cn";
import { deriveSyncPairs } from "@keeper.sh/data-schemas";
import { calendarsInRole, switchMode, toggleCalendar } from "../sync-draft";
import { CalendarOptions } from "./calendar-options";
import { SentencePanel } from "./sentence-panel";
import { SyncSentence } from "./sync-sentence";

interface SyncCalendarsProps {
  value: SyncCalendars;
  calendars: CalendarSource[];
  calendarsById: ReadonlyMap<string, CalendarSource>;
  onChange: (calendars: SyncCalendars) => void;
  onConnect?: (role: SyncCalendarRole) => void;
  // Inside the lifted block so it stays sharp over the overlay and answers each pick as it's made.
  notice?: ReactNode;
}

const MODE_OPTIONS: { label: string; value: SyncMode }[] = [
  { label: "One Way", value: "one_way" },
  { label: "Both Ways", value: "both_ways" },
];

const OTHER_END: Partial<Record<SyncCalendarRole, SyncCalendarRole>> = { destination: "source", source: "destination" };

export function SyncCalendars({ value, calendars, calendarsById, onChange, onConnect, notice }: SyncCalendarsProps) {
  const [openRole, setOpenRole] = useState<SyncCalendarRole | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpenRole(null), []);
  const pairCount = deriveSyncPairs(value).length;
  const otherEnd = openRole ? OTHER_END[openRole] : undefined;

  return (
    <div ref={anchorRef} className={cn("relative flex flex-col gap-1.5", openRole && "z-20")}>
      <div className="flex items-center justify-between gap-2 px-0.5 pt-3">
        <SegmentedControl
          label="Direction"
          options={MODE_OPTIONS}
          value={value.mode}
          onChange={(mode) => { close(); onChange(switchMode(value, mode, calendarsById)); }}
        />
        <Text size="sm" tone="muted">{pairCount === 1 ? "1 calendar link" : `${pairCount} calendar links`}</Text>
      </div>
      <div className="px-0.5 py-1">
        <SyncSentence
          calendars={value}
          calendarsById={calendarsById}
          openRole={openRole}
          onOpen={(role) => setOpenRole((current) => (current === role ? null : role))}
        />
      </div>
      <SentencePanel open={openRole !== null} anchorRef={anchorRef} onClose={close}>
        {openRole && (
          <CalendarOptions
            role={openRole}
            calendars={calendars}
            selectedIds={calendarsInRole(value, openRole)}
            otherEndIds={otherEnd ? calendarsInRole(value, otherEnd) : []}
            onToggle={(calendarId) => onChange(toggleCalendar(value, openRole, calendarId))}
            onConnect={onConnect ? () => onConnect(openRole) : undefined}
          />
        )}
      </SentencePanel>
      {notice}
    </div>
  );
}
