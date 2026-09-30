import { use, useEffect, useState, useTransition } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import useSWR, { preload, useSWRConfig } from "swr";
import CheckIcon from "lucide-react/dist/esm/icons/check";
import { useAtomValue, useStore } from "jotai";
import type { SyncRange } from "@keeper.sh/data-schemas";
import { useEntitlements } from "@/hooks/use-entitlements";
import { BackButton } from "@/components/ui/primitives/back-button";
import { PageBody } from "@/components/ui/primitives/page-body";
import { StickyPageHeader } from "@/components/ui/primitives/sticky-page-header";
import TriangleAlert from "lucide-react/dist/esm/icons/triangle-alert";
import { MenuHint, PremiumGate } from "@/components/ui/primitives/menu-hint";
import { Pagination, PaginationPrevious, PaginationNext } from "@/components/ui/primitives/pagination";
import { RouteShell } from "@/components/ui/shells/route-shell";
import { useReauthAccounts } from "@/features/dashboard/components/reauth/use-reauth-accounts";
import { MetadataRow } from "@/features/dashboard/components/metadata-row";
import { ProviderIcon } from "@/components/ui/primitives/provider-icon";
import { DashboardHeading1, DashboardSection } from "@/components/ui/primitives/dashboard-heading";
import { apiFetch, fetcher } from "@/lib/fetcher";
import { track, ANALYTICS_EVENTS } from "@/lib/analytics";
import { serializedPatch } from "@/lib/serialized-mutate";
import { InSyncsSection } from "@/features/syncs/components/in-syncs-section";
import { invalidateAccountsAndSources } from "@/lib/swr";
import { formatDate } from "@/lib/time";
import { resolveErrorMessage } from "@/utils/errors";
import { canPull, canPush } from "@/utils/calendars";
import type { CalendarAccount, CalendarDetail, CalendarSource } from "@/types/api";
import {
  NavigationMenu,
  NavigationMenuButtonItem,
  NavigationMenuItemIcon,
  NavigationMenuLinkItem,
  NavigationMenuItemLabel,
  NavigationMenuItemTrailing,
} from "@/components/ui/composites/navigation-menu/navigation-menu-items";
import { NavigationMenuPopover } from "@/components/ui/composites/navigation-menu/navigation-menu-popover";
import { NavigationMenuEditableItem } from "@/components/ui/composites/navigation-menu/navigation-menu-editable";
import { MenuVariantContext, ItemDisabledContext, usePopover } from "@/components/ui/composites/navigation-menu/navigation-menu.contexts";
import {
  DISABLED_LABEL_TONE,
  LABEL_TONE,
  navigationMenuItemStyle,
  navigationMenuToggleTrack,
  navigationMenuToggleThumb,
} from "@/components/ui/composites/navigation-menu/navigation-menu.styles";
import { Text } from "@/components/ui/primitives/text";
import { DeleteConfirmation } from "@/components/ui/primitives/delete-confirmation";
import {
  calendarDetailAtom,
  calendarDetailLoadedAtom,
  calendarDetailErrorAtom,
  calendarNameAtom,
  calendarProviderAtom,
  calendarProviderMissingSinceAtom,
  calendarTypeAtom,
  treatFullDayTimedEventsAsAllDayAtom,
} from "@/state/calendar-detail";
import {
  getSyncRangeLabel,
  SYNC_RANGE_OPTIONS,
} from "@/features/dashboard/components/sync-range-options";


export const Route = createFileRoute(
  "/(dashboard)/dashboard/accounts/$accountId/$calendarId",
)({
  component: CalendarDetailPage,
});

function patchSource(
  store: ReturnType<typeof useStore>,
  calendarId: string,
  patch: Record<string, unknown>,
) {
  const swrKey = `/api/sources/${calendarId}`;
  serializedPatch(
    swrKey,
    patch,
    (mergedPatch) => {
      return apiFetch(swrKey, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mergedPatch),
      });
    },
    () => {
      fetcher<CalendarDetail>(swrKey).then((serverState) => {
        store.set(calendarDetailAtom, serverState);
      });
    },
  );
}

function useSeedCalendarDetail(calendarId: string, calendar: CalendarDetail | undefined) {
  const store = useStore();

  useEffect(() => {
    if (!calendar) return;
    if (store.get(calendarDetailLoadedAtom) === calendarId) return;

    store.set(calendarDetailAtom, calendar);
    store.set(calendarDetailLoadedAtom, calendarId);
    store.set(calendarDetailErrorAtom, null);
  }, [calendarId, calendar, store]);
}

function CalendarDetailPage() {
  const { accountId, calendarId } = Route.useParams();
  const { data: account, isLoading: accountLoading, error: accountError, mutate: mutateAccount } = useSWR<CalendarAccount>(`/api/accounts/${accountId}`);
  const { data: calendar, isLoading: calendarLoading, error: calendarError } = useSWR<CalendarDetail>(`/api/sources/${calendarId}`);
  const { mutate: mutateCalendar } = useSWRConfig();

  useSeedCalendarDetail(calendarId, calendar);

  const isLoading = accountLoading || calendarLoading;
  const error = accountError || calendarError;

  if (error || isLoading || !account || !calendar) {
    if (error) return <RouteShell backFallback={`/dashboard/accounts/${accountId}`} status="error" onRetry={async () => { await Promise.all([mutateAccount(), mutateCalendar(`/api/sources/${calendarId}`)]); }} />;
    return <RouteShell backFallback={`/dashboard/accounts/${accountId}`} status="loading" />;
  }

  const isPullCapable = canPull(calendar);
  const isPushCapable = canPush(calendar);

  return (
    <div className="flex flex-col gap-1.5 lg:h-full">
      <StickyPageHeader className="gap-1.5">
        <div className="flex items-center justify-between">
          <BackButton fallback={`/dashboard/accounts/${accountId}`} />
          <CalendarPrevNext calendarId={calendarId} />
        </div>
        <CalendarHeader account={account} />
      </StickyPageHeader>
      <PageBody className="gap-1.5">
        <ReauthNotice account={account} />
        <ProviderMissingNotice />
        <RenameSection calendarId={calendarId} />
        <InSyncsSection calendarId={calendarId} calendarName={calendar.name} />
        {isPushCapable && <SyncWindowSection calendarId={calendarId} />}
        {isPullCapable && calendar.calendarType === "ical" && <AllDayEventsSection calendarId={calendarId} />}
        <CalendarInfoSection account={account} accountId={accountId} />
        {!isPushCapable && <DeleteCalendarSection accountId={accountId} calendarId={calendarId} />}
      </PageBody>
    </div>
  );
}

type SyncRangeField = "syncHistoricRange" | "syncFutureRange";

function SyncWindowSection({ calendarId }: { calendarId: string }) {
  const { data: entitlements } = useEntitlements();
  const locked = Boolean(entitlements && !entitlements.canUseEventFilters);
  const disabled = !entitlements || locked;

  return (
    <>
      <DashboardSection
        title="Sync Window"
        description="Choose how far back and ahead Keeper syncs events into this calendar. Narrowing a range removes already-synced events outside it from this calendar."
      />
      <PremiumGate locked={locked} hint="Custom sync windows are a Pro feature.">
        <NavigationMenu>
          <SyncRangeItem
            calendarId={calendarId}
            field="syncHistoricRange"
            label="Sync Historic Events"
            locked={disabled}
          />
          <SyncRangeItem
            calendarId={calendarId}
            field="syncFutureRange"
            label="Sync Future Events"
            locked={disabled}
          />
        </NavigationMenu>
      </PremiumGate>
    </>
  );
}

function SyncRangeItem({
  calendarId,
  field,
  label,
  locked,
}: {
  calendarId: string;
  field: SyncRangeField;
  label: string;
  locked: boolean;
}) {
  const store = useStore();
  const calendar = useAtomValue(calendarDetailAtom);
  const loadedCalendarId = useAtomValue(calendarDetailLoadedAtom);

  if (!calendar || loadedCalendarId !== calendarId) {
    return null;
  }

  const selectedRange = calendar[field];

  const selectRange = (range: SyncRange) => {
    if (locked || range === selectedRange) {
      return;
    }

    track(ANALYTICS_EVENTS.calendar_setting_toggled, { field, value: range });
    store.set(calendarDetailAtom, (previous) => (
      previous ? { ...previous, [field]: range } : previous
    ));
    patchSource(store, calendarId, { [field]: range });
  };

  return (
    <NavigationMenuPopover
      disabled={locked}
      trigger={
        <>
          <NavigationMenuItemLabel>{label}</NavigationMenuItemLabel>
          <NavigationMenuItemTrailing>
            <Text size="sm" tone={locked ? "disabled" : "muted"}>
              {getSyncRangeLabel(selectedRange)}
            </Text>
          </NavigationMenuItemTrailing>
        </>
      }
    >
      {SYNC_RANGE_OPTIONS.map((option) => (
        <SyncRangeOptionItem
          key={option.value}
          option={option}
          selected={option.value === selectedRange}
          onSelect={selectRange}
        />
      ))}
    </NavigationMenuPopover>
  );
}

function SyncRangeOptionItem({
  option,
  selected,
  onSelect,
}: {
  option: (typeof SYNC_RANGE_OPTIONS)[number];
  selected: boolean;
  onSelect: (range: SyncRange) => void;
}) {
  const { close } = usePopover();

  return (
    <NavigationMenuButtonItem
      onClick={() => {
        onSelect(option.value);
        close();
      }}
    >
      <NavigationMenuItemLabel>{option.label}</NavigationMenuItemLabel>
      <NavigationMenuItemTrailing>
        {selected && <CheckIcon size={14} />}
      </NavigationMenuItemTrailing>
    </NavigationMenuButtonItem>
  );
}

function CalendarPrevNext({ calendarId }: { calendarId: string }) {
  const { data: allCalendars } = useSWR<CalendarSource[]>("/api/sources");
  const calendars = allCalendars ?? [];

  const currentIndex = calendars.findIndex((c) => c.id === calendarId);
  const prev = currentIndex > 0 ? calendars[currentIndex - 1] : null;
  const next = currentIndex < calendars.length - 1 ? calendars[currentIndex + 1] : null;

  useEffect(() => {
    if (prev) preload(`/api/sources/${prev.id}`, fetcher);
    if (next) preload(`/api/sources/${next.id}`, fetcher);
  }, [prev, next]);

  const toCalendar = (c: CalendarSource) => `/dashboard/accounts/${c.accountId}/${c.id}`;

  return (
    <Pagination>
      <PaginationPrevious to={prev ? toCalendar(prev) : undefined} />
      <PaginationNext to={next ? toCalendar(next) : undefined} />
    </Pagination>
  );
}

function CalendarHeader({ account }: { account: CalendarAccount }) {
  const provider = useAtomValue(calendarProviderAtom);
  const calendarType = useAtomValue(calendarTypeAtom);

  return (
    <div className="flex flex-col px-0.5 pt-4">
      <CalendarTitle />
      <div className="flex items-center gap-1.5 pt-0.5">
        <ProviderIcon provider={provider} calendarType={calendarType} size={14} />
        <Text className="truncate overflow-hidden" size="sm" tone="muted">{account.accountLabel}</Text>
      </div>
    </div>
  );
}

function CalendarTitle() {
  const name = useAtomValue(calendarNameAtom);
  return <DashboardHeading1 className="select-none">{name}</DashboardHeading1>;
}

function RenameSection({ calendarId }: { calendarId: string }) {
  return (
    <>
      <DashboardSection
        title="Calendar Name"
        description="Click below to rename the calendar within Keeper.sh. This does not affect the calendar outside of the Keeper.sh ecosystem."
      />
      <NavigationMenu>
        <RenameItem calendarId={calendarId} />
      </NavigationMenu>
    </>
  );
}

function RenameItem({ calendarId }: { calendarId: string }) {
  const store = useStore();
  const name = useAtomValue(calendarNameAtom);

  return (
    <NavigationMenuEditableItem
      value={name}
      onCommit={(newName) => {
        track(ANALYTICS_EVENTS.calendar_renamed);
        store.set(calendarDetailAtom, (prev) => (prev ? { ...prev, name: newName } : prev));
        patchSource(store, calendarId, { name: newName });
      }}
    >
      <RenameItemValue />
    </NavigationMenuEditableItem>
  );
}

function RenameItemValue() {
  const name = useAtomValue(calendarNameAtom);
  const variant = use(MenuVariantContext);
  const disabled = use(ItemDisabledContext);

  return (
    <Text
      size="sm"
      tone={(disabled ? DISABLED_LABEL_TONE : LABEL_TONE)[variant ?? "default"]}
      className="min-w-0 truncate"
    >
      {name}
    </Text>
  );
}

/** Leads the page when the owning account has lost authorization; this calendar cannot sync until it is restored. */
function ReauthNotice({ account }: { account: CalendarAccount }) {
  const needsReauth = useReauthAccounts().some((entry) => entry.id === account.id);
  if (!needsReauth) return null;

  return (
    <>
      <NavigationMenu variant="attention">
        <NavigationMenuLinkItem to={`/dashboard/accounts/${account.id}/reconnect`}>
          <NavigationMenuItemIcon>
            <TriangleAlert size={15} />
          </NavigationMenuItemIcon>
          <NavigationMenuItemLabel>Reconnect 1 Account</NavigationMenuItemLabel>
          <NavigationMenuItemTrailing />
        </NavigationMenuLinkItem>
      </NavigationMenu>
      <MenuHint>
        Authorization for this account has been lost. This calendar will drift out of date until
        access is restored.
      </MenuHint>
    </>
  );
}

function ProviderMissingNotice() {
  const providerMissingSince = useAtomValue(calendarProviderMissingSinceAtom);
  if (!providerMissingSince) return null;

  return (
    <Text size="sm" tone="danger" className="px-0.5">
      This calendar was not found the last time its connection was refreshed
      (since {formatDate(providerMissingSince)}) - it may have been deleted or renamed at the
      provider. Refresh the connection again to confirm, or remove the calendar below.
    </Text>
  );
}

function DeleteCalendarSection({ accountId, calendarId }: { accountId: string; calendarId: string }) {
  const { mutate: globalMutate } = useSWRConfig();
  const navigate = useNavigate();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isDeleting, startDeleteTransition] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleConfirmDelete = () => {
    setDeleteError(null);

    startDeleteTransition(async () => {
      try {
        await apiFetch(`/api/sources/${calendarId}`, { method: "DELETE" });
        track(ANALYTICS_EVENTS.source_calendar_deleted);
        await invalidateAccountsAndSources(globalMutate, `/api/accounts/${accountId}`);
        navigate({ to: `/dashboard/accounts/${accountId}` });
      } catch (err) {
        setDeleteError(resolveErrorMessage(err, "Failed to delete calendar."));
      }
    });
  };

  return (
    <>
      <DashboardSection
        title="Remove Calendar"
        description="Stop syncing this calendar and remove it from Keeper.sh. It will be re-imported the next time you refresh the account's calendars, unless it no longer exists at the provider."
      />
      <NavigationMenu>
        <NavigationMenuButtonItem onClick={() => setDeleteOpen(true)}>
          <Text size="sm" tone="danger">Delete Calendar</Text>
        </NavigationMenuButtonItem>
      </NavigationMenu>
      {deleteError && <Text size="sm" tone="danger" className="px-0.5">{deleteError}</Text>}
      <DeleteConfirmation
        title="Delete this calendar?"
        description="This removes the calendar and its sync history from Keeper.sh. Any syncs using it stop copying to and from it."
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        deleting={isDeleting}
        onConfirm={handleConfirmDelete}
      />
    </>
  );
}

function AllDayEventsSection({ calendarId }: { calendarId: string }) {
  const { data: entitlements } = useEntitlements();
  const locked = Boolean(entitlements && !entitlements.canUseEventFilters);

  return (
    <>
      <DashboardSection
        title="All-Day Events"
        description="Treat timed events that span a whole day as all-day when copying them."
      />
      <PremiumGate locked={locked} hint="Advanced sync settings are a Pro feature.">
        <NavigationMenu>
          <TreatFullDayTimedEventsToggle calendarId={calendarId} locked={locked} />
        </NavigationMenu>
      </PremiumGate>
    </>
  );
}

function TreatFullDayTimedEventsToggle({ calendarId, locked }: { calendarId: string; locked: boolean }) {
  const store = useStore();
  const variant = use(MenuVariantContext);

  const handleClick = () => {
    if (locked) return;
    const current = store.get(calendarDetailAtom);
    if (!current) return;

    const treatFullDayTimedEventsAsAllDay = !current.treatFullDayTimedEventsAsAllDay;
    track(ANALYTICS_EVENTS.calendar_setting_toggled, {
      field: "treatFullDayTimedEventsAsAllDay",
      enabled: treatFullDayTimedEventsAsAllDay,
    });
    store.set(calendarDetailAtom, (prev) => {
      if (!prev) {
        return prev;
      }
      return { ...prev, treatFullDayTimedEventsAsAllDay };
    });
    patchSource(store, calendarId, { treatFullDayTimedEventsAsAllDay });
  };

  return (
    <li>
      <ItemDisabledContext value={locked}>
        <button
          type="button"
          role="switch"
          disabled={locked}
          onClick={handleClick}
          className={navigationMenuItemStyle({ variant, interactive: !locked })}
        >
          <NavigationMenuItemLabel>Sync Full-Day Events as All-Day</NavigationMenuItemLabel>
          <TreatFullDayTimedEventsToggleIndicator disabled={locked} />
        </button>
      </ItemDisabledContext>
    </li>
  );
}

function TreatFullDayTimedEventsToggleIndicator({ disabled }: { disabled: boolean }) {
  const checked = useAtomValue(treatFullDayTimedEventsAsAllDayAtom);
  const variant = use(MenuVariantContext);

  return (
    <div className={navigationMenuToggleTrack({ variant, checked, disabled, className: "ml-auto" })}>
      <div className={navigationMenuToggleThumb({ variant, checked })} />
    </div>
  );
}

function CalendarInfoSection({ account, accountId }: { account: CalendarAccount; accountId: string }) {
  const calendar = useAtomValue(calendarDetailAtom);

  if (!calendar) return null;

  return (
    <>
      <DashboardSection
        title="Calendar Information"
        description="View details about the calendar."
      />
      <NavigationMenu>
        <MetadataRow label="Resource Type" value="Calendar" />
        <MetadataRow label="Type" value={calendar.calendarType} />
        <MetadataRow label="Capabilities" value={calendar.capabilities.join(", ")} />
        {calendar.unavailableSince && (
          <MetadataRow
            label="Availability"
            value={`Unavailable since ${formatDate(calendar.unavailableSince)}`}
            truncate
          />
        )}
        {calendar.originalName && (
          <MetadataRow label="Original Source Name" value={calendar.originalName} truncate />
        )}
        {calendar.url && (
          <MetadataRow label="URL" value={calendar.url} truncate />
        )}
        {calendar.calendarUrl && (
          <MetadataRow label="Calendar URL" value={calendar.calendarUrl} truncate />
        )}
        <MetadataRow label="Added" value={formatDate(calendar.createdAt)} />
        <MetadataRow
          label="Account Identifier"
          value={account.accountIdentifier ?? ""}
          truncate
          to={`/dashboard/accounts/${accountId}`}
        />
      </NavigationMenu>
    </>
  );
}
