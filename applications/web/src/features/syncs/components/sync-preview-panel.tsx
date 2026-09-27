import ArrowRight from "lucide-react/dist/esm/icons/arrow-right";
import type { SyncSettings } from "@keeper.sh/data-schemas";
import { DashboardSection } from "@/components/ui/primitives/dashboard-heading";
import { Text } from "@/components/ui/primitives/text";
import { NavigationMenu, NavigationMenuItem } from "@/components/ui/composites/navigation-menu/navigation-menu-items";
import { PREVIEW_EVENTS, previewSync } from "../syncs";
import { PreviewEventCard } from "./share-as-section";

interface SyncPreviewPanelProps {
  settings: SyncSettings;
  sourceName: string;
  destinationName: string;
}

const PREVIEW_ROW = "grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-2";

export function SyncPreviewPanel({ settings, sourceName, destinationName }: SyncPreviewPanelProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <DashboardSection
        title="Preview"
        description={`How a few typical events from ${sourceName} land in ${destinationName}. It updates as you change the sync.`}
      />
      <NavigationMenu>
        <NavigationMenuItem className={PREVIEW_ROW}>
          <Text size="xs" tone="muted" className="truncate">In {sourceName}</Text>
          <span className="w-3.5" />
          <Text size="xs" tone="muted" className="truncate">In {destinationName}</Text>
        </NavigationMenuItem>
        {PREVIEW_EVENTS.map((event) => {
          const preview = previewSync(settings, event, sourceName);
          return (
            <li key={event.title} className="flex flex-col gap-1.5 border-t border-dashed border-interactive-border px-3.5 py-3 sm:px-3">
              <div className={PREVIEW_ROW}>
                <PreviewEventCard copy={event} />
                <ArrowRight size={14} className="self-center text-foreground-muted" />
                <PreviewEventCard copy={preview.copy} />
              </div>
              <Text size="xs" tone="muted">
                Decided by <span className="text-foreground">{preview.decidedBy}</span>
              </Text>
            </li>
          );
        })}
      </NavigationMenu>
    </div>
  );
}
