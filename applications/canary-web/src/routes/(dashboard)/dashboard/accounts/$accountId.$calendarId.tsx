import { use, useEffect, useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import useSWR, { preload, useSWRConfig } from "swr";
import CheckIcon from "lucide-react/dist/esm/icons/check";
import { useAtomValue, useStore } from "jotai";
import { BackButton } from "../../../../components/ui/primitives/back-button";
import { Pagination, PaginationPrevious, PaginationNext } from "../../../../components/ui/primitives/pagination";
import { RouteShell } from "../../../../components/ui/shells/route-shell";
import { MetadataRow } from "../../../../features/dashboard/components/metadata-row";
import { ProviderIcon } from "../../../../components/ui/primitives/provider-icon";
import { DashboardHeading1, DashboardSection } from "../../../../components/ui/primitives/dashboard-heading";
import { apiFetch, fetcher } from "../../../../lib/fetcher";
import { formatDate } from "../../../../lib/time";
import { getAccountLabel } from "../../../../utils/accounts";
import { canPull, canPush } from "../../../../utils/calendars";
import type { CalendarAccount, CalendarDetail, CalendarSource } from "../../../../types/api";
import {
  NavigationMenu,
  NavigationMenuEmptyItem,
  NavigationMenuItemIcon,
  NavigationMenuItemLabel,
} from "../../../../components/ui/composites/navigation-menu/navigation-menu-items";
import {
  NavigationMenuEditableItem,
  NavigationMenuEditableTemplateItem,
} from "../../../../components/ui/composites/navigation-menu/navigation-menu-editable";
import { MenuVariantContext, ItemDisabledContext } from "../../../../components/ui/composites/navigation-menu/navigation-menu.contexts";
import {
  DISABLED_LABEL_TONE,
  LABEL_TONE,
  navigationMenuItemStyle,
  navigationMenuCheckbox,
  navigationMenuCheckboxIcon,
  navigationMenuToggleTrack,
  navigationMenuToggleThumb,
} from "../../../../components/ui/composites/navigation-menu/navigation-menu.styles";
import { Text } from "../../../../components/ui/primitives/text";
import { TemplateText } from "../../../../components/ui/primitives/template-text";
import {
  calendarDetailAtom,
  calendarDetailLoadedAtom,
  calendarDetailErrorAtom,
  calendarNameAtom,
  calendarProviderAtom,
  calendarTypeAtom,
  customEventNameAtom,
  excludeEventNameAtom,
  excludeFieldAtoms,
} from "../../../../state/calendar-detail";
import type { ExcludeField } from "../../../../state/calendar-detail";
import {
  destinationIdsAtom,
  selectDestinationInclusion,
} from "../../../../state/destination-ids";

export const Route = createFileRoute(
  "/(dashboard)/dashboard/accounts/$accountId/$calendarId",
)({
  component: CalendarDetailPage,
});

interface SyncSetting {
  field: ExcludeField;
  label: string;
  matchesField: boolean;
}

const SYNC_SETTINGS: SyncSetting[] = [
  { field: "excludeEventDescription", label: "Sync Event Description", matchesField: false },
  { field: "excludeEventLocation", label: "Sync Event Location", matchesField: false },
];

const EXCLUSION_SETTINGS: SyncSetting[] = [
  { field: "excludeAllDayEvents", label: "Exclude All Day Events", matchesField: true },
];

const PROVIDER_EXCLUSION_SETTINGS: SyncSetting[] = [
  { field: "excludeFocusTime", label: "Exclude Focus Time Events", matchesField: true },
  { field: "excludeWorkingLocation", label: "Exclude Working Location Events", matchesField: true },
  { field: "excludeOutOfOffice", label: "Exclude Out of Office Events", matchesField: true },
];

const PROVIDERS_WITH_EXTRA_SETTINGS = new Set(["google"]);

function patchSource(
  mutate: ReturnType<typeof useSWRConfig>["mutate"],
  calendarId: string,
  patch: Record<string, unknown>,
) {
  mutate(
    `/api/sources/${calendarId}`,
    async (current: CalendarDetail | undefined) => {
      await apiFetch(`/api/sources/${calendarId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      return current ? { ...current, ...patch } : current;
    },
    {
      optimisticData: (current: CalendarDetail | undefined) =>
        current ? { ...current, ...patch } : current!,
      rollbackOnError: true,
      revalidate: false,
    },
  );
}

function useSeedCalendarDetail(calendarId: string, calendar: CalendarDetail | undefined) {
  const store = useStore();

  if (calendar && store.get(calendarDetailLoadedAtom) !== calendarId) {
    store.set(calendarDetailAtom, calendar);
    store.set(calendarDetailLoadedAtom, calendarId);
    store.set(calendarDetailErrorAtom, null);
    store.set(destinationIdsAtom, new Set<string>());
  }
}

function CalendarDetailPage() {
  const { accountId, calendarId } = Route.useParams();
  const { data: account, isLoading: accountLoading, error: accountError, mutate: mutateAccount } = useSWR<CalendarAccount>(`/api/accounts/${accountId}`);
  const { data: calendar, isLoading: calendarLoading, error: calendarError } = useSWR<CalendarDetail>(`/api/sources/${calendarId}`);
  const { mutate: mutateCalendar } = useSWRConfig();
  const store = useStore();

  useSeedCalendarDetail(calendarId, calendar);

  const isLoading = accountLoading || calendarLoading;
  const error = accountError || calendarError;

  if (error || isLoading || !account || !calendar) {
    if (error) return <RouteShell backFallback={`/dashboard/accounts/${accountId}`} status="error" onRetry={async () => { await Promise.all([mutateAccount(), mutateCalendar(`/api/sources/${calendarId}`)]); }} />;
    return <RouteShell backFallback={`/dashboard/accounts/${accountId}`} status="loading" />;
  }

  const isPullCapable = canPull(calendar);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <BackButton fallback={`/dashboard/accounts/${accountId}`} />
        <CalendarPrevNext calendarId={calendarId} />
      </div>
      <CalendarHeader account={account} />
      <RenameSection calendarId={calendarId} />
      {isPullCapable && (
        <>
          <DashboardSection
            title="Send Events to Calendars"
            description="Select which calendars should receive events from this calendar."
          />
          <DestinationsSection calendarId={calendarId} />
        </>
      )}
      {isPullCapable && <SyncSettingsSection calendarId={calendarId} />}
      {isPullCapable && <ExclusionsSection calendarId={calendarId} provider={calendar.provider} />}
      <CalendarInfoSection account={account} accountId={accountId} />
    </div>
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
  }, [prev?.id, next?.id]);

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
        <Text className="truncate overflow-hidden" size="sm" tone="muted">{getAccountLabel(account)}</Text>
      </div>
    </div>
  );
}

function CalendarTitle() {
  const name = useAtomValue(calendarNameAtom);
  return <DashboardHeading1>{name}</DashboardHeading1>;
}

function RenameSection({ calendarId }: { calendarId: string }) {
  return (
    <>
      <DashboardSection
        title="Calendar Name"
        description="Click below to rename the calendar within Keeper. This does not affect the calendar outside of the Keeper ecosystem."
      />
      <NavigationMenu>
        <RenameItem calendarId={calendarId} />
      </NavigationMenu>
    </>
  );
}

function RenameItem({ calendarId }: { calendarId: string }) {
  const store = useStore();
  const { mutate } = useSWRConfig();

  return (
    <NavigationMenuEditableItem
      getValue={() => store.get(calendarNameAtom)}
      onCommit={(newName) => {
        store.set(calendarDetailAtom, (prev) => (prev ? { ...prev, name: newName } : prev));
        patchSource(mutate, calendarId, { name: newName });
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

function DestinationsSeed({ calendarId }: { calendarId: string }) {
  const { data } = useSWR<{ destinationIds: string[] }>(
    `/api/sources/${calendarId}/destinations`,
  );
  const store = useStore();

  useEffect(() => {
    if (!data) {
      return;
    }

    if (store.get(destinationIdsAtom).size !== 0) {
      return;
    }

    store.set(destinationIdsAtom, new Set(data.destinationIds));
  }, [data, store]);

  return null;
}

function DestinationsSection({ calendarId }: { calendarId: string }) {
  const { data: allCalendars } = useSWR<CalendarSource[]>("/api/sources");

  const pushCalendars = useMemo(
    () => (allCalendars ?? []).filter((calendar) => canPush(calendar) && calendar.id !== calendarId),
    [allCalendars, calendarId],
  );

  return (
    <>
      <DestinationsSeed calendarId={calendarId} />
      <NavigationMenu>
        {pushCalendars.length === 0 ? (
          <NavigationMenuEmptyItem>No destination calendars available</NavigationMenuEmptyItem>
        ) : (
          pushCalendars.map((calendar) => (
            <DestinationCheckboxItem
              key={calendar.id}
              calendarId={calendarId}
              destinationId={calendar.id}
              name={calendar.name}
              provider={calendar.provider}
              calendarType={calendar.calendarType}
            />
          ))
        )}
      </NavigationMenu>
    </>
  );
}

function DestinationCheckboxItem({
  calendarId,
  destinationId,
  name,
  provider,
  calendarType,
}: {
  calendarId: string;
  destinationId: string;
  name: string;
  provider: string;
  calendarType: string;
}) {
  const store = useStore();
  const variant = use(MenuVariantContext);
  const { mutate } = useSWRConfig();

  const handleClick = () => {
    const currentIds = store.get(destinationIdsAtom);
    const checked = !currentIds.has(destinationId);
    const updatedSet = new Set(currentIds);

    if (checked) {
      updatedSet.add(destinationId);
    } else {
      updatedSet.delete(destinationId);
    }

    store.set(destinationIdsAtom, updatedSet);

    const updatedIds = Array.from(updatedSet);
    mutate(
      `/api/sources/${calendarId}/destinations`,
      async () => {
        await apiFetch(`/api/sources/${calendarId}/destinations`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ calendarIds: updatedIds }),
        });
        return { destinationIds: updatedIds };
      },
      {
        optimisticData: { destinationIds: updatedIds },
        rollbackOnError: true,
        revalidate: false,
      },
    );
  };

  return (
    <li>
      <button
        type="button"
        role="checkbox"
        onClick={handleClick}
        className={navigationMenuItemStyle({ variant })}
      >
        <NavigationMenuItemIcon>
          <ProviderIcon provider={provider} calendarType={calendarType} />
        </NavigationMenuItemIcon>
        <NavigationMenuItemLabel>{name}</NavigationMenuItemLabel>
        <DestinationCheckboxIndicator destinationId={destinationId} />
      </button>
    </li>
  );
}

function DestinationCheckboxIndicator({ destinationId }: { destinationId: string }) {
  const checkedAtom = useMemo(() => selectDestinationInclusion(destinationId), [destinationId]);
  const checked = useAtomValue(checkedAtom);
  const variant = use(MenuVariantContext);

  return (
    <div className={navigationMenuCheckbox({ variant, checked, className: "ml-auto" })}>
      {checked && <CheckIcon size={12} className={navigationMenuCheckboxIcon({ variant })} />}
    </div>
  );
}

function SyncSettingsSection({ calendarId }: { calendarId: string }) {
  return (
    <>
      <DashboardSection
        title="Sync Settings"
        description={<>Choose which event details are synced to destination calendars. Use <Text as="span" size="sm" className="text-template inline">{"{{calendar_name}}"}</Text> or <Text as="span" size="sm" className="text-template inline">{"{{event_name}}"}</Text> in text fields for dynamic values.</>}
      />
      <NavigationMenu>
        <SyncEventNameTemplateItem calendarId={calendarId} />
        <SyncEventNameToggle calendarId={calendarId} />
        {SYNC_SETTINGS.map((setting) => (
          <ExcludeFieldToggle
            key={setting.field}
            calendarId={calendarId}
            field={setting.field}
            label={setting.label}
            matchesField={setting.matchesField}
          />
        ))}
      </NavigationMenu>
    </>
  );
}

function SyncEventNameDisabledProvider({ children }: { children: React.ReactNode }) {
  const excludeEventName = useAtomValue(excludeEventNameAtom);
  return <ItemDisabledContext value={!excludeEventName}>{children}</ItemDisabledContext>;
}

function SyncEventNameTemplateItem({ calendarId }: { calendarId: string }) {
  const store = useStore();
  const { mutate } = useSWRConfig();

  return (
    <SyncEventNameDisabledProvider>
      <NavigationMenuEditableTemplateItem
        label="Event Name"
        getValue={() => store.get(calendarDetailAtom)?.customEventName || "{{event_name}}"}
        renderInput={(live) => (
          <SyncEventNameTemplateInput template={live} />
        )}
        onCommit={(customEventName) => {
          store.set(calendarDetailAtom, (prev) => (prev ? { ...prev, customEventName } : prev));
          patchSource(mutate, calendarId, { customEventName });
        }}
      >
        <SyncEventNameTemplateValue />
      </NavigationMenuEditableTemplateItem>
    </SyncEventNameDisabledProvider>
  );
}

function SyncEventNameTemplateInput({ template }: { template: string }) {
  return <TemplateText template={template} variables={TEMPLATE_VARIABLES} />;
}

const TEMPLATE_VARIABLES = { calendar_name: "Calendar Name", event_name: "Event Name" };

function SyncEventNameTemplateValue() {
  const customEventName = useAtomValue(customEventNameAtom);
  const excludeEventName = useAtomValue(excludeEventNameAtom);
  const disabled = !excludeEventName;
  const template = customEventName || "{{event_name}}";

  return (
    <Text
      size="sm"
      tone={disabled ? "disabled" : "muted"}
      className="min-w-0 truncate flex-1 text-right"
    >
      <TemplateText
        template={template}
        variables={TEMPLATE_VARIABLES}
        disabled={disabled}
      />
    </Text>
  );
}

function SyncEventNameToggle({ calendarId }: { calendarId: string }) {
  const store = useStore();
  const variant = use(MenuVariantContext);
  const { mutate } = useSWRConfig();

  const handleClick = () => {
    const current = store.get(calendarDetailAtom);
    if (!current) return;

    const patch = current.excludeEventName
      ? { excludeEventName: false, customEventName: "{{event_name}}" }
      : { excludeEventName: true, customEventName: "{{calendar_name}}" };

    store.set(calendarDetailAtom, (prev) => (prev ? { ...prev, ...patch } : prev));
    patchSource(mutate, calendarId, patch);
  };

  return (
    <li>
      <button
        type="button"
        role="switch"
        onClick={handleClick}
        className={navigationMenuItemStyle({ variant })}
      >
        <NavigationMenuItemLabel>Sync Event Name</NavigationMenuItemLabel>
        <SyncEventNameToggleIndicator />
      </button>
    </li>
  );
}

function SyncEventNameToggleIndicator() {
  const excludeEventName = useAtomValue(excludeEventNameAtom);
  const variant = use(MenuVariantContext);
  const checked = !excludeEventName;

  return (
    <div className={navigationMenuToggleTrack({ variant, checked, className: "ml-auto" })}>
      <div className={navigationMenuToggleThumb({ variant, checked })} />
    </div>
  );
}

function ExclusionsSection({ calendarId, provider }: { calendarId: string; provider: string }) {
  const hasExtraSettings = PROVIDERS_WITH_EXTRA_SETTINGS.has(provider);
  const exclusionSettings = hasExtraSettings
    ? [...EXCLUSION_SETTINGS, ...PROVIDER_EXCLUSION_SETTINGS]
    : EXCLUSION_SETTINGS;

  return (
    <>
      <DashboardSection
        title="Exclusions"
        description="Choose which event types to exclude from syncing."
      />
      <NavigationMenu>
        {exclusionSettings.map((setting) => (
          <ExcludeFieldToggle
            key={setting.field}
            calendarId={calendarId}
            field={setting.field}
            label={setting.label}
            matchesField={setting.matchesField}
          />
        ))}
      </NavigationMenu>
    </>
  );
}

function ExcludeFieldToggle({
  calendarId,
  field,
  label,
  matchesField,
}: {
  calendarId: string;
  field: ExcludeField;
  label: string;
  matchesField: boolean;
}) {
  const store = useStore();
  const variant = use(MenuVariantContext);
  const { mutate } = useSWRConfig();

  const handleClick = () => {
    const current = store.get(calendarDetailAtom);
    if (!current) return;

    const newValue = !current[field];
    store.set(calendarDetailAtom, (prev) => (prev ? { ...prev, [field]: newValue } : prev));
    patchSource(mutate, calendarId, { [field]: newValue });
  };

  return (
    <li>
      <button
        type="button"
        role="switch"
        onClick={handleClick}
        className={navigationMenuItemStyle({ variant })}
      >
        <NavigationMenuItemLabel>{label}</NavigationMenuItemLabel>
        <ExcludeFieldToggleIndicator field={field} matchesField={matchesField} />
      </button>
    </li>
  );
}

function ExcludeFieldToggleIndicator({ field, matchesField }: { field: ExcludeField; matchesField: boolean }) {
  const raw = useAtomValue(excludeFieldAtoms[field]);
  const variant = use(MenuVariantContext);
  const checked = matchesField ? raw : !raw;

  return (
    <div className={navigationMenuToggleTrack({ variant, checked, className: "ml-auto" })}>
      <div className={navigationMenuToggleThumb({ variant, checked })} />
    </div>
  );
}

function CalendarInfoSection({ account, accountId }: { account: CalendarAccount; accountId: string }) {
  const store = useStore();
  const calendar = store.get(calendarDetailAtom);

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
        {calendar.url && (
          <MetadataRow label="URL" value={calendar.url} truncate />
        )}
        {calendar.calendarUrl && (
          <MetadataRow label="Calendar URL" value={calendar.calendarUrl} truncate />
        )}
        <MetadataRow label="Added" value={formatDate(calendar.createdAt)} />
        <MetadataRow
          label="Account"
          value={getAccountLabel(account)}
          truncate
          to={`/dashboard/accounts/${accountId}`}
        />
      </NavigationMenu>
    </>
  );
}
