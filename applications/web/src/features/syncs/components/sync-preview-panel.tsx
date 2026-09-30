import { useState } from "react";
import ArrowRight from "lucide-react/dist/esm/icons/arrow-right";
import CheckIcon from "lucide-react/dist/esm/icons/check";
import type { SyncSettings } from "@keeper.sh/data-schemas";
import { DashboardHeading2 } from "@/components/ui/primitives/dashboard-heading";
import { Text } from "@/components/ui/primitives/text";
import { Tooltip } from "@/components/ui/primitives/tooltip";
import {
  NavigationMenu,
  NavigationMenuButtonItem,
  NavigationMenuItem,
  NavigationMenuItemLabel,
  NavigationMenuItemTrailing,
} from "@/components/ui/composites/navigation-menu/navigation-menu-items";
import { NavigationMenuPopover } from "@/components/ui/composites/navigation-menu/navigation-menu-popover";
import { usePopover } from "@/components/ui/composites/navigation-menu/navigation-menu.contexts";
import { previewEventsFor, previewSync, shareAsLabel, type PreviewDirection } from "../syncs";
import { PreviewEventCard } from "./share-as-section";

interface SyncPreviewPanelProps {
  settings: SyncSettings;
  directions: PreviewDirection[];
}

const PREVIEW_ROW = "grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-2";

export function SyncPreviewPanel({ settings, directions }: SyncPreviewPanelProps) {
  const [pickedKey, setPickedKey] = useState<string | null>(null);
  const direction = directions.find((candidate) => candidate.key === pickedKey) ?? directions[0];
  if (!direction) return null;
  const { source: sourceName, destinations } = direction;
  const [firstDestination, ...otherDestinations] = destinations;
  const previews = previewEventsFor(settings).map((event) => ({ event, preview: previewSync(settings, event, sourceName) }));
  const copied = previews.filter(({ preview }) => preview.copy).length;
  const ruled = previews.some(({ preview }) => preview.copy && !preview.followsShareAs);

  return (
    <div className="-mx-1 flex flex-col gap-1 rounded-[1.25rem] border border-border-elevated p-1 *:transition-[filter] [&:has([data-popover-open])>:not(:has([data-popover-open]))]:blur-[2px]">
      <div className="flex flex-col px-4 pt-2.5 sm:px-3.5">
        <DashboardHeading2>Preview</DashboardHeading2>
        <Text size="sm">Sample events, and what their copies would look like.</Text>
      </div>
      <ul className="flex flex-col p-0.5 *:transition-[filter] [&>[data-popover-open]~*]:blur-[2px]">
        {directions.length > 1 && (
          <NavigationMenuPopover
            trigger={(
              <NavigationMenuItemLabel tone="muted">
                Events from <span className="text-foreground">{sourceName}</span>
              </NavigationMenuItemLabel>
            )}
          >
            {directions.map((candidate) => (
              <PreviewSourceOption
                key={candidate.key}
                direction={candidate}
                picked={candidate === direction}
                onPick={() => setPickedKey(candidate.key)}
              />
            ))}
          </NavigationMenuPopover>
        )}
        <NavigationMenuItem className={PREVIEW_ROW}>
          <Text size="xs" tone="muted" className="truncate">In {sourceName}</Text>
          <span className="w-3.5" />
          <div className="flex min-w-0 justify-between gap-2">
            <div className="flex min-w-0 items-baseline gap-1">
              <Text size="xs" tone="muted" className="truncate">In {firstDestination}</Text>
              {otherDestinations.length > 0 && (
                <Tooltip content={otherDestinations.join(", ")}>
                  <Text as="span" size="xs" tone="muted" className="shrink-0 tabular-nums">+{otherDestinations.length}</Text>
                </Tooltip>
              )}
            </div>
            <Text size="xs" tone="muted" className="shrink-0 tabular-nums">{copied} of {previews.length} copied</Text>
          </div>
        </NavigationMenuItem>
      </ul>
      <NavigationMenu>
        {previews.map(({ event, preview }) => (
          <li key={event.title} className="flex flex-col gap-1.5 border-dashed border-interactive-border px-3.5 py-2.5 not-first:border-t sm:px-3">
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
      </NavigationMenu>
      <Text size="xs" tone="muted" className="px-4 pt-1.5 pb-2.5 sm:px-3.5">
        {ruled ? "Other copies follow" : "Copies follow"}{" "}
        <span className="text-foreground">Share As · {shareAsLabel(settings.shareAs)}</span>
      </Text>
    </div>
  );
}

function PreviewSourceOption({ direction, picked, onPick }: { direction: PreviewDirection; picked: boolean; onPick: () => void }) {
  const { close } = usePopover();
  return (
    <NavigationMenuButtonItem onClick={() => { onPick(); close(); }}>
      <NavigationMenuItemLabel>{direction.source}</NavigationMenuItemLabel>
      <NavigationMenuItemTrailing indicator={null} className="ml-auto shrink-0 grow-0 max-w-[55%]">
        <Text size="sm" tone="muted" align="right" className="min-w-0 truncate">To {direction.destinations.join(", ")}</Text>
        {picked && <CheckIcon size={14} className="shrink-0 text-foreground" />}
      </NavigationMenuItemTrailing>
    </NavigationMenuButtonItem>
  );
}
