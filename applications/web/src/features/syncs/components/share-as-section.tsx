import { useState, type PropsWithChildren } from "react";
import CheckIcon from "lucide-react/dist/esm/icons/check";
import Lock from "lucide-react/dist/esm/icons/lock";
import ArrowRight from "lucide-react/dist/esm/icons/arrow-right";
import RotateCcw from "lucide-react/dist/esm/icons/rotate-ccw";
import { DEFAULT_BUSY_TITLE } from "@keeper.sh/data-schemas";
import type { ShareAs, SyncSettings } from "@keeper.sh/data-schemas";
import { DashboardSection } from "@/components/ui/primitives/dashboard-heading";
import { MenuHint } from "@/components/ui/primitives/menu-hint";
import { TemplateText } from "@/components/ui/primitives/template-text";
import { Text } from "@/components/ui/primitives/text";
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuItemIcon,
  NavigationMenuItemLabel,
  NavigationMenuItemTrailing,
  NavigationMenuToggleItem,
} from "@/components/ui/composites/navigation-menu/navigation-menu-items";
import { NavigationMenuEditableTemplateItem } from "@/components/ui/composites/navigation-menu/navigation-menu-editable";
import { cn } from "@/utils/cn";
import { EVENT_COLORS } from "@/features/dashboard/components/event-card.styles";
import { BUSY_TEMPLATE_VARIABLES } from "../rule-editing";
import { busyTitleProblem } from "../sync-draft";
import { SHARE_AS_OPTIONS, previewEventsFor, previewSync, type PreviewCopy } from "../syncs";
import { RowIconButton } from "./row-remove-button";
import { SelectableItem } from "./selectable-item";

interface ShareAsSectionProps {
  settings: SyncSettings;
  sourceName: string;
  locked: boolean;
  previewClassName?: string;
  onChange: (patch: Partial<SyncSettings>) => void;
}

export function ShareAsSection({ settings, sourceName, locked, previewClassName, onChange }: ShareAsSectionProps) {
  const titleProblem = busyTitleProblem(settings.busyTitle);

  return (
    <>
      <DashboardSection title="Share As" description="How copies look in the destination. Advanced rules start from this." />
      <NavigationMenu>
        {SHARE_AS_OPTIONS.map((option) => (
          <ShareAsOption
            key={option.value}
            option={option}
            busyTitle={settings.busyTitle}
            selected={settings.shareAs === option.value}
            locked={locked && option.value !== "busy_only" && settings.shareAs !== option.value}
            onSelect={(shareAs) => onChange({ shareAs })}
          />
        ))}
        {settings.shareAs === "busy_only" && (
          <BusyTitleItem busyTitle={settings.busyTitle} locked={locked} onChange={(busyTitle) => onChange({ busyTitle })} />
        )}
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
      {settings.shareAs === "busy_only" && titleProblem && <MenuHint tone="danger">{titleProblem}</MenuHint>}
      <SyncPreviewCard settings={settings} sourceName={sourceName} className={previewClassName} />
    </>
  );
}

interface ShareAsOptionProps {
  option: (typeof SHARE_AS_OPTIONS)[number];
  busyTitle: string | null;
  selected: boolean;
  locked: boolean;
  onSelect: (shareAs: ShareAs) => void;
}

function ShareAsOption({ option, busyTitle, selected, locked, onSelect }: ShareAsOptionProps) {
  const titled = option.value === "busy_only" && busyTitle !== null;

  return (
    <SelectableItem role="radio" checked={selected} disabled={locked} onSelect={() => onSelect(option.value)}>
      <div className="flex min-w-0 flex-col">
        <NavigationMenuItemLabel>{option.label}</NavigationMenuItemLabel>
        <Text size="xs" tone="muted" className="truncate">
          {titled ? <>Just the time, titled “<TemplateText template={busyTitle} variables={BUSY_TEMPLATE_VARIABLES} />”</> : option.description}
        </Text>
      </div>
      <NavigationMenuItemTrailing className="ml-auto shrink-0 grow-0">
        {locked && <Text size="xs" tone="muted">Pro</Text>}
        {selected && <CheckIcon size={14} className="text-foreground" />}
      </NavigationMenuItemTrailing>
    </SelectableItem>
  );
}

interface BusyTitleItemProps {
  busyTitle: string | null;
  locked: boolean;
  onChange: (busyTitle: string | null) => void;
}

// A free plan may keep, or reset, a title it already has, but not set a new one.
function BusyTitleItem({ busyTitle, locked, onChange }: BusyTitleItemProps) {
  const template = busyTitle ?? DEFAULT_BUSY_TITLE;
  const reset = busyTitle !== null && (
    <RowIconButton label="Reset the busy title to the calendar name" className="mr-2" onClick={() => onChange(null)}>
      <RotateCcw size={14} />
    </RowIconButton>
  );

  return (
    <NavigationMenuEditableTemplateItem
      label="Busy Title"
      value={template}
      disabled={locked}
      trailing={reset || undefined}
      renderInput={(live) => <TemplateText template={live} variables={BUSY_TEMPLATE_VARIABLES} />}
      onCommit={(next) => onChange(next === DEFAULT_BUSY_TITLE ? null : next)}
    >
      <Text size="sm" tone="muted" className="min-w-0 flex-1 truncate text-right">
        {locked && busyTitle === null ? "Pro" : <TemplateText template={template} variables={BUSY_TEMPLATE_VARIABLES} />}
      </Text>
    </NavigationMenuEditableTemplateItem>
  );
}

function SyncPreviewCard({ settings, sourceName, className }: { settings: SyncSettings; sourceName: string; className?: string }) {
  const [sampleIndex, setSampleIndex] = useState(0);
  const events = previewEventsFor(settings);
  const sample = events[sampleIndex] ?? events[0];
  if (!sample) return null;
  const preview = previewSync(settings, sample, sourceName);

  return (
    <NavigationMenu className={className}>
      <NavigationMenuItem className="flex-wrap gap-1.5">
        <Text size="xs" tone="muted" className="mr-1">Preview with</Text>
        {events.map((event, index) => (
          <PreviewChip key={event.title} pressed={index === sampleIndex} onClick={() => setSampleIndex(index)}>
            {event.title}
          </PreviewChip>
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

function PreviewChip({ pressed, onClick, children }: PropsWithChildren<{ pressed: boolean; onClick: () => void }>) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "rounded-lg border px-2 py-0.5 text-xs tracking-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        pressed
          ? "border-foreground bg-foreground text-background"
          : "border-interactive-border text-foreground hover:bg-background-hover",
      )}
    >
      {children}
    </button>
  );
}

export function PreviewEventCard({ label, copy, dropped = [] }: { label?: string; copy: PreviewCopy | null; dropped?: string[] }) {
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
          {dropped.map((detail) => <p key={detail} className="truncate line-through opacity-45">{detail}</p>)}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-interactive-border px-2 py-1.5 text-xs text-foreground-muted">
          Not copied
        </div>
      )}
    </div>
  );
}
