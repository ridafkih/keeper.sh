import { useState } from "react";
import ArrowRight from "lucide-react/dist/esm/icons/arrow-right";
import type { SyncSettings } from "@keeper.sh/data-schemas";
import { DashboardSection } from "@/components/ui/primitives/dashboard-heading";
import { Text } from "@/components/ui/primitives/text";
import { NavigationMenu, NavigationMenuItem } from "@/components/ui/composites/navigation-menu/navigation-menu-items";
import { previewEventsFor, previewSync, shareAsLabel, type PreviewDirection } from "../syncs";
import { PreviewChip, PreviewEventCard } from "./share-as-section";

interface SyncPreviewPanelProps {
  settings: SyncSettings;
  directions: PreviewDirection[];
}

const PREVIEW_ROW = "grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-2";

const listNames = (names: string[]): string =>
  names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : (names[0] ?? "");

export function SyncPreviewPanel({ settings, directions }: SyncPreviewPanelProps) {
  const [pickedKey, setPickedKey] = useState<string | null>(null);
  const direction = directions.find((candidate) => candidate.key === pickedKey) ?? directions[0];
  if (!direction) return null;
  const { source: sourceName, destinations } = direction;
  const [firstDestination] = destinations;
  const destinationName = destinations.length > 1 ? `${firstDestination} +${destinations.length - 1}` : firstDestination;
  const previews = previewEventsFor(settings).map((event) => ({ event, preview: previewSync(settings, event, sourceName) }));
  const copied = previews.filter(({ preview }) => preview.copy).length;
  const ruled = previews.some(({ preview }) => preview.copy && !preview.followsShareAs);

  return (
    <div className="flex flex-col gap-1.5">
      <DashboardSection title="Preview" description={`Typical events from ${sourceName}, and how they'd land in ${listNames(destinations)}.`} />
      <NavigationMenu>
        {directions.length > 1 && (
          <NavigationMenuItem className="flex-wrap gap-1.5">
            <Text size="xs" tone="muted" className="mr-1">Events from</Text>
            {directions.map((candidate) => (
              <PreviewChip key={candidate.key} pressed={candidate === direction} onClick={() => setPickedKey(candidate.key)}>
                {candidate.source}
              </PreviewChip>
            ))}
          </NavigationMenuItem>
        )}
        <NavigationMenuItem className={PREVIEW_ROW}>
          <Text size="xs" tone="muted" className="truncate">In {sourceName}</Text>
          <span className="w-3.5" />
          <div className="flex min-w-0 justify-between gap-2">
            <Text size="xs" tone="muted" className="truncate">In {destinationName}</Text>
            <Text size="xs" tone="muted" className="shrink-0 tabular-nums">{copied} of {previews.length} copied</Text>
          </div>
        </NavigationMenuItem>
        {previews.map(({ event, preview }) => (
          <li key={event.title} className="flex flex-col gap-1.5 border-t border-dashed border-interactive-border px-3.5 py-2.5 sm:px-3">
            <div className={PREVIEW_ROW}>
              <PreviewEventCard copy={event} />
              <ArrowRight size={14} className="self-center text-foreground-muted" />
              {preview.copy ? (
                <PreviewEventCard copy={preview.copy} dropped={preview.dropped} />
              ) : (
                <div className="flex min-w-0 flex-col rounded-lg border border-dashed border-interactive-border px-2 py-1.5 text-xs leading-snug">
                  <p className="truncate text-foreground">Stays in {sourceName}</p>
                  <p className="text-foreground-muted">{preview.decidedBy}</p>
                </div>
              )}
            </div>
            {preview.copy && !preview.followsShareAs && (
              <Text size="xs" tone="muted">
                Changed by <span className="text-foreground">{preview.decidedBy}</span>
              </Text>
            )}
          </li>
        ))}
        <li className="border-t border-interactive-border px-3.5 py-2.5 sm:px-3">
          <Text size="xs" tone="muted">
            {ruled ? "Other copies follow" : "Copies follow"}{" "}
            <span className="text-foreground">Share As · {shareAsLabel(settings.shareAs)}</span>
          </Text>
        </li>
      </NavigationMenu>
    </div>
  );
}
