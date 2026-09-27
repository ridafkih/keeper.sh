import { useState } from "react";
import CheckIcon from "lucide-react/dist/esm/icons/check";
import Lock from "lucide-react/dist/esm/icons/lock";
import ArrowRight from "lucide-react/dist/esm/icons/arrow-right";
import type { ShareAs, SyncSettings } from "@keeper.sh/data-schemas";
import { DashboardSection } from "@/components/ui/primitives/dashboard-heading";
import { Text } from "@/components/ui/primitives/text";
import {
  NavigationMenu,
  NavigationMenuButtonItem,
  NavigationMenuItem,
  NavigationMenuItemIcon,
  NavigationMenuItemLabel,
  NavigationMenuItemTrailing,
  NavigationMenuToggleItem,
} from "@/components/ui/composites/navigation-menu/navigation-menu-items";
import { cn } from "@/utils/cn";
import { EVENT_COLORS } from "@/features/dashboard/components/event-card.styles";
import { PREVIEW_EVENTS, SHARE_AS_OPTIONS, previewSync, type PreviewCopy } from "../syncs";

interface ShareAsSectionProps {
  settings: SyncSettings;
  sourceName: string;
  locked: boolean;
  previewClassName?: string;
  onChange: (patch: Partial<SyncSettings>) => void;
}

export function ShareAsSection({ settings, sourceName, locked, previewClassName, onChange }: ShareAsSectionProps) {
  return (
    <>
      <DashboardSection title="Share As" description="How copies look in the destination, unless a rule below says otherwise." />
      <NavigationMenu>
        {SHARE_AS_OPTIONS.map((option) => (
          <ShareAsOption
            key={option.value}
            option={option}
            selected={settings.shareAs === option.value}
            locked={locked && option.value !== "busy_only" && settings.shareAs !== option.value}
            onSelect={(shareAs) => onChange({ shareAs })}
          />
        ))}
        <NavigationMenuToggleItem
          checked={settings.markPrivate}
          disabled={locked && !settings.markPrivate}
          onCheckedChange={(markPrivate) => onChange({ markPrivate })}
        >
          <NavigationMenuItemIcon>
            <Lock size={15} />
          </NavigationMenuItemIcon>
          <div className="flex min-w-0 flex-col">
            <NavigationMenuItemLabel>Mark Copies Private</NavigationMenuItemLabel>
            <Text size="xs" tone="muted">Includes copies changed by rules</Text>
          </div>
        </NavigationMenuToggleItem>
      </NavigationMenu>
      <SyncPreviewCard settings={settings} sourceName={sourceName} className={previewClassName} />
    </>
  );
}

interface ShareAsOptionProps {
  option: (typeof SHARE_AS_OPTIONS)[number];
  selected: boolean;
  locked: boolean;
  onSelect: (shareAs: ShareAs) => void;
}

function ShareAsOption({ option, selected, locked, onSelect }: ShareAsOptionProps) {
  return (
    <NavigationMenuButtonItem disabled={locked} onClick={() => onSelect(option.value)}>
      <div className="flex min-w-0 flex-col">
        <NavigationMenuItemLabel>{option.label}</NavigationMenuItemLabel>
        <Text size="xs" tone="muted">{option.description}</Text>
      </div>
      <NavigationMenuItemTrailing className="ml-auto shrink-0 grow-0">
        {locked && <Text size="xs" tone="muted">Pro</Text>}
        {selected && <CheckIcon size={14} className="text-foreground" />}
      </NavigationMenuItemTrailing>
    </NavigationMenuButtonItem>
  );
}

function SyncPreviewCard({ settings, sourceName, className }: { settings: SyncSettings; sourceName: string; className?: string }) {
  const [sampleIndex, setSampleIndex] = useState(0);
  const sample = PREVIEW_EVENTS[sampleIndex] ?? PREVIEW_EVENTS[0];
  if (!sample) return null;
  const preview = previewSync(settings, sample, sourceName);

  return (
    <NavigationMenu className={className}>
      <NavigationMenuItem className="flex-wrap gap-1.5">
        <Text size="xs" tone="muted" className="mr-1">Preview with</Text>
        {PREVIEW_EVENTS.map((event, index) => (
          <button
            key={event.title}
            type="button"
            aria-pressed={index === sampleIndex}
            onClick={() => setSampleIndex(index)}
            className={cn(
              "rounded-lg border px-2 py-0.5 text-xs tracking-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              index === sampleIndex
                ? "border-foreground bg-foreground text-background"
                : "border-interactive-border text-foreground hover:bg-background-hover",
            )}
          >
            {event.title}
          </button>
        ))}
      </NavigationMenuItem>
      <li className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-2 px-3.5 pb-1 sm:px-3">
        <PreviewEventCard label={`In ${sourceName}`} copy={sample} />
        <ArrowRight size={14} className="self-center text-foreground-muted" />
        <PreviewEventCard label="The copy" copy={preview.copy} />
      </li>
      <NavigationMenuItem>
        <Text size="xs" tone="muted">
          Decided by <span className="text-foreground">{preview.decidedBy}</span>
        </Text>
      </NavigationMenuItem>
    </NavigationMenu>
  );
}

export function PreviewEventCard({ label, copy }: { label?: string; copy: PreviewCopy | null }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      {label && <Text size="xs" tone="muted" className="truncate">{label}</Text>}
      {copy ? (
        <div className={cn(EVENT_COLORS.blue, "relative min-w-0 rounded-lg bg-(--event-surface) py-1.5 pr-2 pl-3 text-xs leading-snug text-(--event-ink) before:absolute before:inset-y-1.5 before:left-1 before:w-0.5 before:rounded-full before:bg-(--event-accent)")}>
          <p className="flex items-center gap-1 truncate font-medium">
            {copy.isPrivate && <Lock size={10} className="shrink-0" />}
            {copy.title}
          </p>
          <p className="truncate opacity-80">{[copy.time, copy.location].filter(Boolean).join(" · ")}</p>
          {copy.description && <p className="truncate opacity-80">{copy.description}</p>}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-interactive-border px-2 py-1.5 text-xs text-foreground-muted">
          Not copied
        </div>
      )}
    </div>
  );
}
