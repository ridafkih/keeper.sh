import type { ReactNode } from "react";
import type { SyncCalendarRole, SyncDefinition, SyncSettings, SyncSummary } from "@keeper.sh/data-schemas";
import type { CalendarSource } from "@/types/api";
import { previewDirections, syncSettingsOf } from "../syncs";
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
  previewClassName?: string;
  onChange: (patch: Partial<SyncDefinition>) => void;
  onConnect?: (role: SyncCalendarRole) => void;
}

export function SyncEditor({ value, calendars, otherSyncs, locked, notice, previewClassName, onChange, onConnect }: SyncEditorProps) {
  const calendarsById = new Map(calendars.map((calendar) => [calendar.id, calendar] as const));
  const settings: SyncSettings = syncSettingsOf(value);
  const sourceName = previewDirections(value, calendarsById)[0]?.source ?? "Your calendar";

  return (
    <div className="flex flex-col gap-1.5">
      <SyncCalendars
        value={value}
        calendars={calendars}
        calendarsById={calendarsById}
        onChange={(next) => onChange(next)}
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
