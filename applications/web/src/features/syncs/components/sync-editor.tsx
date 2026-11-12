import type { ReactNode } from "react";
import type { SyncCalendarRole, SyncCalendars, SyncDefinition, SyncSettings, SyncSummary } from "@keeper.sh/data-schemas";
import { useEntitlements } from "@/hooks/use-entitlements";
import type { CalendarSource } from "@/types/api";
import { syncCalendarLimit } from "../sync-plan";
import { previewDirections, syncSettingsOf } from "../syncs";
import { AdvancedRules } from "./advanced-rules";
import { NeverCopySection } from "./never-copy-section";
import { ShareAsSection } from "./share-as-section";
import { SyncCalendars as SyncCalendarsPicker } from "./sync-calendars";

interface SyncEditorProps {
  value: SyncDefinition;
  calendars: CalendarSource[];
  otherSyncs: SyncSummary[];
  locked: boolean;
  // The saved sync's calendars, whose lists may stay as long as they are past the plan's cap.
  saved?: SyncCalendars | null;
  notice?: ReactNode;
  previewClassName?: string;
  onChange: (patch: Partial<SyncDefinition>) => void;
  onConnect?: (role: SyncCalendarRole) => void;
}

export function SyncEditor({ value, calendars, otherSyncs, locked, saved = null, notice, previewClassName, onChange, onConnect }: SyncEditorProps) {
  const { data: entitlements } = useEntitlements();
  const calendarsById = new Map(calendars.map((calendar) => [calendar.id, calendar] as const));
  const settings: SyncSettings = syncSettingsOf(value);
  const sourceName = previewDirections(value, calendarsById)[0]?.source ?? "Your calendar";

  return (
    <div className="flex flex-col gap-1.5">
      <SyncCalendarsPicker
        value={value}
        calendars={calendars}
        calendarsById={calendarsById}
        calendarLimit={syncCalendarLimit(entitlements)}
        saved={saved}
        onChange={onChange}
        onConnect={onConnect}
        notice={notice}
      />
      <ShareAsSection settings={settings} sourceName={sourceName} locked={locked} previewClassName={previewClassName} onChange={onChange} />
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
