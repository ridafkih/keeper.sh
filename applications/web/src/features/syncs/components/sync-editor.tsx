import type { ReactNode } from "react";
import type { SyncCalendarRole, SyncCalendars as SyncCalendarsValue, SyncDefinition, SyncSettings, SyncSummary } from "@keeper.sh/data-schemas";
import type { CalendarSource } from "@/types/api";
import { syncSettingsOf } from "../syncs";
import { AdvancedRules } from "./advanced-rules";
import { NeverCopySection } from "./never-copy-section";
import { ShareAsSection } from "./share-as-section";
import { SyncCalendars } from "./sync-calendars";

interface SyncEditorProps {
  value: SyncDefinition;
  calendars: CalendarSource[];
  otherSyncs: SyncSummary[];
  locked: boolean;
  notice?: ReactNode;
  onChange: (patch: Partial<SyncDefinition>) => void;
  onConnect?: (role: SyncCalendarRole) => void;
}

const firstCalendarId = (calendars: SyncCalendarsValue): string | undefined =>
  calendars.memberCalendarIds[0] ?? calendars.sourceCalendarIds[0];

export function SyncEditor({ value, calendars, otherSyncs, locked, notice, onChange, onConnect }: SyncEditorProps) {
  const calendarsById = new Map(calendars.map((calendar) => [calendar.id, calendar] as const));
  const settings: SyncSettings = syncSettingsOf(value);
  const sourceId = firstCalendarId(value);
  const sourceName = (sourceId && calendarsById.get(sourceId)?.name) || "Work";

  return (
    <div className="flex flex-col gap-1.5">
      <SyncCalendars
        value={value}
        calendars={calendars}
        calendarsById={calendarsById}
        onChange={(next) => onChange(next)}
        onConnect={onConnect}
      />
      {notice}
      <ShareAsSection settings={settings} sourceName={sourceName} locked={locked} onChange={onChange} />
      <NeverCopySection settings={settings} locked={locked} onChange={onChange} />
      <div className="pt-3">
        <AdvancedRules
          rules={value.rules}
          shareAs={value.shareAs}
          locked={locked}
          otherSyncs={otherSyncs}
          onChange={(rules) => onChange({ rules })}
        />
      </div>
    </div>
  );
}
