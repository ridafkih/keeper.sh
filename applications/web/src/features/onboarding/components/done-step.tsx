import { useState } from "react";
import { useAtomValue } from "jotai";
import useSWR from "swr";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import ChevronUp from "lucide-react/dist/esm/icons/chevron-up";
import List from "lucide-react/dist/esm/icons/list";
import type { SyncDetail } from "@keeper.sh/data-schemas";
import { ButtonText, LinkButton } from "@/components/ui/primitives/button";
import { Heading2 } from "@/components/ui/primitives/heading";
import { ProviderIcon } from "@/components/ui/primitives/provider-icon";
import { ShimmerText } from "@/components/ui/primitives/shimmer-text";
import { Text } from "@/components/ui/primitives/text";
import {
  NavigationMenu,
  NavigationMenuButtonItem,
  NavigationMenuItem,
  NavigationMenuItemIcon,
  NavigationMenuItemLabel,
  NavigationMenuItemTrailing,
} from "@/components/ui/composites/navigation-menu/navigation-menu-items";
import { SyncProgressCircle } from "@/features/dashboard/components/sync-status";
import { canAddMore, useEntitlements } from "@/hooks/use-entitlements";
import { fetcher } from "@/lib/fetcher";
import { syncStateAtom } from "@/state/sync";
import type { CalendarSource } from "@/types/api";
import { summarizeSync, syncKey } from "@/features/syncs/syncs";
import { resolveFirstRunProgress, type FirstRunProgress } from "../first-run";

const POLL_MS = 3000;
const COPIES_SHOWN = 10;

interface SyncCopy {
  destinationCalendarId: string;
  endTime: string;
  id: string;
  isAllDay: boolean;
  sourceCalendarId: string;
  startTime: string;
  title: string | null;
}

const dayFormat = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", weekday: "short" });
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

const describeWhen = (copy: SyncCopy): string => {
  const start = new Date(copy.startTime);
  if (copy.isAllDay) return `${dayFormat.format(start)} · All day`;
  return `${dayFormat.format(start)} · ${timeFormat.format(start)} – ${timeFormat.format(new Date(copy.endTime))}`;
};

// Mirrors what the copy is called in the destination: busy blocks carry the busy title or the source calendar's name.
const describeCopy = (copy: SyncCopy, sync: SyncDetail, calendarsById: ReadonlyMap<string, CalendarSource>): string => {
  if (sync.shareAs === "busy_only") return sync.busyTitle ?? calendarsById.get(copy.sourceCalendarId)?.name ?? "Busy";
  return copy.title ?? "Untitled";
};

const STATUS_LABELS: Record<FirstRunProgress["kind"], string> = {
  copying: "Copying your events",
  counting: "Copying your events",
  finished: "Up to Date",
};

const progressCount = (progress: FirstRunProgress): string => {
  if (progress.kind === "finished") return `${progress.copied.toLocaleString()} copied`;
  if (progress.kind === "copying") return `${progress.processed.toLocaleString()} of ${progress.total.toLocaleString()}`;
  return `Counting events · ${Math.round(progress.percent)}%`;
};

const progressPercent = (progress: FirstRunProgress): number => (progress.kind === "finished" ? 100 : progress.percent);

export function DoneStep({ syncId }: { syncId: string }) {
  const [showActivity, setShowActivity] = useState(false);
  const aggregate = useAtomValue(syncStateAtom);
  const { data: entitlements } = useEntitlements();
  const { data: sources } = useSWR<CalendarSource[]>("/api/sources");
  const { data: sync } = useSWR<SyncDetail>(syncKey(syncId), fetcher, {
    refreshInterval: (latest) => (resolveFirstRunProgress(latest, aggregate).kind === "finished" ? 0 : POLL_MS),
  });
  const progress = resolveFirstRunProgress(sync, aggregate);
  const finished = progress.kind === "finished";
  const { data: copies } = useSWR<{ copies: SyncCopy[] }>(
    showActivity ? `${syncKey(syncId)}/copies?limit=${COPIES_SHOWN}` : null,
    fetcher,
    { refreshInterval: finished ? 0 : POLL_MS },
  );
  const calendarsById = new Map((sources ?? []).map((source) => [source.id, source] as const));
  const atSyncLimit = !canAddMore(entitlements?.syncs);

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-1.5">
      <div className="flex items-center gap-2 px-0.5 pb-2">
        <SyncProgressCircle percent={progressPercent(progress)} />
        {finished ? (
          <Text size="sm" tone="default">{STATUS_LABELS[progress.kind]}</Text>
        ) : (
          <ShimmerText className="text-sm tracking-tight">{STATUS_LABELS[progress.kind]}</ShimmerText>
        )}
        <Text size="sm" tone="muted" className="ml-auto tabular-nums">{progressCount(progress)}</Text>
      </div>
      <div className="flex flex-col gap-1 px-0.5 pb-3">
        <Heading2 as="h1">{finished ? "You're All Set" : "Your First Sync Is Running"}</Heading2>
        <Text size="sm" tone="muted">
          {finished
            ? "Everything in your sync window is copied. New events follow within minutes."
            : "You can leave this page. Keeper keeps going and nothing here needs watching."}
        </Text>
      </div>
      {sync && (
        <NavigationMenu>
          <NavigationMenuItem>
            <span className="size-2 shrink-0 rounded-full bg-emerald-500" />
            <div className="flex min-w-0 flex-col">
              <Text size="sm" tone="default" className="truncate">{sync.name}</Text>
              <Text size="xs" tone="muted" className="truncate">{summarizeSync(sync, calendarsById)}</Text>
            </div>
            <NavigationMenuItemTrailing indicator={<Text size="xs" tone="muted">just now</Text>} />
          </NavigationMenuItem>
          <li className="px-3.5 pb-2 sm:px-3">
            <div
              role="progressbar"
              aria-label="First run"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progressPercent(progress))}
              className="h-1 overflow-hidden rounded-full bg-background-hover"
            >
              <div
                className="h-full rounded-full bg-foreground transition-[width] duration-300 ease-out motion-reduce:transition-none"
                style={{ width: `${progressPercent(progress)}%` }}
              />
            </div>
          </li>
        </NavigationMenu>
      )}
      <div className="flex flex-col gap-1.5 pt-3">
        <LinkButton to="/dashboard" className="w-full justify-center">
          <ButtonText>Go to Dashboard</ButtonText>
        </LinkButton>
        <LinkButton to={atSyncLimit ? "/dashboard/upgrade" : "/dashboard/syncs/new"} variant="border" className="w-full justify-center">
          <ButtonText>Add Another Sync</ButtonText>
          {atSyncLimit && <Text as="span" size="xs" tone="muted" className="ml-1.5">Pro</Text>}
        </LinkButton>
      </div>
      {sync && (
        // The list hangs below the step instead of growing it, so opening it doesn't move the centred content.
        <div className="relative pt-1.5">
          <NavigationMenu>
            <NavigationMenuButtonItem onClick={() => setShowActivity((open) => !open)}>
              <NavigationMenuItemIcon>
                <List size={15} />
              </NavigationMenuItemIcon>
              <NavigationMenuItemLabel>{showActivity ? "Hide Activity" : "Show Activity"}</NavigationMenuItemLabel>
              <NavigationMenuItemTrailing indicator={showActivity ? <ChevronUp size={15} /> : <ChevronDown size={15} />} />
            </NavigationMenuButtonItem>
          </NavigationMenu>
          {showActivity && (
            <div className="absolute inset-x-0 top-full pt-1.5 pb-12">
              <NavigationMenu>
                {(copies?.copies ?? []).length === 0 ? (
                  <NavigationMenuItem>
                    <Text size="sm" tone="muted">Waiting for the first copy.</Text>
                  </NavigationMenuItem>
                ) : (
                  copies?.copies.map((copy) => (
                    <NavigationMenuItem key={copy.id}>
                      <NavigationMenuItemIcon>
                        <ProviderIcon provider={calendarsById.get(copy.destinationCalendarId)?.provider} />
                      </NavigationMenuItemIcon>
                      <div className="flex min-w-0 flex-col">
                        <Text size="sm" tone="default" className="truncate">
                          {describeCopy(copy, sync, calendarsById)} → {calendarsById.get(copy.destinationCalendarId)?.name ?? "Calendar"}
                        </Text>
                        <Text size="xs" tone="muted" className="truncate tabular-nums">{describeWhen(copy)}</Text>
                      </div>
                    </NavigationMenuItem>
                  ))
                )}
              </NavigationMenu>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
