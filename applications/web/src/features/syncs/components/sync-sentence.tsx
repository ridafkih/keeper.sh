import { Fragment } from "react";
import type { SyncCalendarRole, SyncCalendars } from "@keeper.sh/data-schemas";
import { heading } from "@/components/ui/primitives/heading.styles";
import { ProviderIcon } from "@/components/ui/primitives/provider-icon";
import type { CalendarSource } from "@/types/api";
import { calendarsInRole } from "../sync-draft";
import { SentenceBlank } from "./sentence-blank";

interface SyncSentenceProps {
  calendars: SyncCalendars;
  calendarsById: ReadonlyMap<string, CalendarSource>;
  openRole: SyncCalendarRole | null;
  onOpen: (role: SyncCalendarRole) => void;
}

const EMPTY_LABELS: Record<SyncCalendarRole, string> = {
  destination: "another calendar",
  member: "two or more calendars",
  source: "a calendar",
};

export function SyncSentence({ calendars, calendarsById, openRole, onOpen }: SyncSentenceProps) {
  const blanks = (role: SyncCalendarRole) => {
    const ids = calendarsInRole(calendars, role).filter((id) => calendarsById.has(id));
    const open = openRole === role;
    if (ids.length === 0) {
      return <SentenceBlank filled={false} open={open} label={EMPTY_LABELS[role]} onClick={() => onOpen(role)} />;
    }
    return (
      <>
        {ids.map((id, index) => {
          const calendar = calendarsById.get(id);
          if (!calendar) return null;
          return (
            <Fragment key={id}>
              {index > 0 && " "}
              <SentenceBlank
                filled
                open={open}
                label={calendar.name}
                icon={<ProviderIcon provider={calendar.provider} calendarType={calendar.calendarType} size={14} />}
                onClick={() => onOpen(role)}
              />
            </Fragment>
          );
        })}
        {" "}
        <SentenceBlank filled={false} open={open} ariaLabel="Add a calendar" onClick={() => onOpen(role)} />
      </>
    );
  };

  return (
    <p className={heading({ level: 3, className: "min-w-0 leading-relaxed" })}>
      {calendars.mode === "both_ways" ? (
        <>Keep {blanks("member")} in step, each blocking the others.</>
      ) : (
        <>Copy events from {blanks("source")} to {blanks("destination")}.</>
      )}
    </p>
  );
}
