import { use, useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import useSWR, { preload, useSWRConfig } from "swr";
import CheckIcon from "lucide-react/dist/esm/icons/check";
import { useAtomValue, useStore } from "jotai";
import type { SyncRange } from "@keeper.sh/data-schemas";
import { useEntitlements, useMutateEntitlements, canAddMore } from "@/hooks/use-entitlements";
import { BackButton } from "@/components/ui/primitives/back-button";
import { UpgradeHint, PremiumFeatureGate } from "@/components/ui/primitives/upgrade-hint";
import { Pagination, PaginationPrevious, PaginationNext } from "@/components/ui/primitives/pagination";
import { RouteShell } from "@/components/ui/shells/route-shell";
import { MetadataRow } from "@/features/dashboard/components/metadata-row";
import { ProviderIcon } from "@/components/ui/primitives/provider-icon";
import { DashboardHeading1, DashboardSection } from "@/components/ui/primitives/dashboard-heading";
import { apiFetch, fetcher } from "@/lib/fetcher";
import { track, ANALYTICS_EVENTS } from "@/lib/analytics";
import { serializedPatch, serializedCall } from "@/lib/serialized-mutate";
import { formatDate } from "@/lib/time";
import { canPull, canPush } from "@/utils/calendars";
import type { CalendarAccount, CalendarDetail, CalendarSource } from "@/types/api";
import {
  NavigationMenu,
  NavigationMenuButtonItem,
  NavigationMenuEmptyItem,
  NavigationMenuItemIcon,
  NavigationMenuItemLabel,
  NavigationMenuItemTrailing,
} from "@/components/ui/composites/navigation-menu/navigation-menu-items";
import { NavigationMenuPopover } from "@/components/ui/composites/navigation-menu/navigation-menu-popover";
import {
  NavigationMenuEditableItem,
  NavigationMenuEditableTemplateItem,
} from "@/components/ui/composites/navigation-menu/navigation-menu-editable";
import { MenuVariantContext, ItemDisabledContext, usePopover } from "@/components/ui/composites/navigation-menu/navigation-menu.contexts";
import {
  DISABLED_LABEL_TONE,
  LABEL_TONE,
  navigationMenuItemStyle,
  navigationMenuCheckbox,
  navigationMenuCheckboxIcon,
  navigationMenuToggleTrack,
  navigationMenuToggleThumb,
} from "@/components/ui/composites/navigation-menu/navigation-menu.styles";
import { Text } from "@/components/ui/primitives/text";
import type { ButtonProps } from "@/components/ui/primitives/button";
import { Collapsible } from "@/components/ui/primitives/collapsible";
import { TemplateText } from "@/components/ui/primitives/template-text";
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
  treatFullDayTimedEventsAsAllDayAtom,
} from "@/state/calendar-detail";
import type { ExcludeField } from "@/state/calendar-detail";
import type { WriteBackMode, WriteBackStatus } from "@/state/destination-ids";
import { resolveDeleteConfirmationAnswers, resolveModeSelection } from "@/lib/write-back-answers";
import {
  resolveUnwritableSourceCopy,
  resolveWriteBackStateCopy,
  supportsWriteBack,
} from "@/lib/write-back-copy";
import { buildWriteBackFieldSummary } from "@/features/dashboard/components/write-back-summary";
import type { DeleteConfirmationAnswer } from "@/lib/write-back-answers";
import {
  destinationIdsAtom,
  selectSiblingDestinationCount,
  selectWriteBackMode,
  selectWriteBackState,
  writeBackModesAtom,
  writeBackStatesAtom,
  selectDestinationInclusion,
} from "@/state/destination-ids";
import {
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalTitle,
} from "@/components/ui/primitives/modal";
import { Button } from "@/components/ui/primitives/button";
import {
  getSyncRangeLabel,
  SYNC_RANGE_OPTIONS,
} from "@/features/dashboard/components/sync-range-options";


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
  { field: "excludeOutOfOffice", label: "Exclude Out of Office Events", matchesField: true },
];

const PROVIDERS_WITH_EXTRA_SETTINGS = new Set(["google"]);

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
      {isPushCapable && <SyncWindowSection calendarId={calendarId} />}
      {isPullCapable && <SyncSettingsSection calendarId={calendarId} />}
      {isPullCapable && <ExclusionsSection calendarId={calendarId} provider={calendar.provider} />}
      <CalendarInfoSection account={account} accountId={accountId} />
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
      <PremiumFeatureGate locked={locked} hint="Custom sync windows are a Pro feature.">
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
      </PremiumFeatureGate>
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

function DestinationsSeed({ calendarId }: { calendarId: string }) {
  const { data } = useSWR<{
    destinationIds: string[];
    writeBackModes?: Record<string, WriteBackMode>;
    writeBackStates?: Record<string, WriteBackStatus>;
  }>(`/api/sources/${calendarId}/destinations`);
  const store = useStore();

  useEffect(() => {
    store.set(destinationIdsAtom, new Set(data?.destinationIds));
    store.set(writeBackModesAtom, data?.writeBackModes ?? {});
    store.set(writeBackStatesAtom, data?.writeBackStates ?? {});
  }, [calendarId, data, store]);

  return null;
}

function DestinationsSection({ calendarId }: { calendarId: string }) {
  const { data: allCalendars } = useSWR<CalendarSource[]>("/api/sources");
  const { data: entitlements } = useEntitlements();
  const atLimit = !canAddMore(entitlements?.mappings);

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
      {atLimit && <UpgradeHint>Mapping limit reached.</UpgradeHint>}
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
  const { data: entitlements } = useEntitlements();
  const { adjustMappingCount, revalidateEntitlements } = useMutateEntitlements();

  const checkedAtom = useMemo(() => selectDestinationInclusion(destinationId), [destinationId]);
  const checked = useAtomValue(checkedAtom);
  const atLimit = !canAddMore(entitlements?.mappings);
  const disabled = atLimit && !checked;

  const handleClick = () => {
    if (disabled) return;

    const currentIds = store.get(destinationIdsAtom);
    const willCheck = !currentIds.has(destinationId);
    track(ANALYTICS_EVENTS.destination_toggled, { enabled: willCheck });
    const updatedSet = new Set(currentIds);

    if (willCheck) {
      updatedSet.add(destinationId);
      adjustMappingCount(1);
    } else {
      updatedSet.delete(destinationId);
      adjustMappingCount(-1);
    }

    store.set(destinationIdsAtom, updatedSet);

    const swrKey = `/api/sources/${calendarId}/destinations`;
    serializedCall(swrKey, () => {
      const latestIds = Array.from(store.get(destinationIdsAtom));
      return mutate(
        swrKey,
        async () => {
          await apiFetch(swrKey, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ calendarIds: latestIds }),
          });
          return { destinationIds: latestIds };
        },
        {
          optimisticData: { destinationIds: latestIds },
          rollbackOnError: true,
          revalidate: false,
        },
      ).catch(() => {
        void mutate(swrKey);
      }).finally(() => {
        void revalidateEntitlements();
      });
    });
  };

  return (
    <li>
      <ItemDisabledContext value={disabled}>
        <button
          type="button"
          role="checkbox"
          disabled={disabled}
          onClick={handleClick}
          className={navigationMenuItemStyle({ variant, interactive: !disabled })}
        >
          <NavigationMenuItemIcon>
            <ProviderIcon provider={provider} calendarType={calendarType} />
          </NavigationMenuItemIcon>
          <NavigationMenuItemLabel>{name}</NavigationMenuItemLabel>
          <DestinationCheckboxIndicator destinationId={destinationId} />
        </button>
      </ItemDisabledContext>
      {checked && (
        <WriteBackModeControl
          calendarId={calendarId}
          destinationId={destinationId}
          destinationName={name}
        />
      )}
    </li>
  );
}

const WRITE_BACK_OPTIONS: { description: string; label: string; mode: WriteBackMode }[] = [
  {
    description: "Changes flow from this calendar to the copy only.",
    label: "One-way",
    mode: "off",
  },
  {
    description: "Editing the copy changes the original event here.",
    label: "Two-way",
    mode: "edits",
  },
  {
    description:
      "Editing the copy changes the original, and deleting the copy permanently deletes "
      + "the original here and removes it from every other calendar it is copied to. "
      + "Keeper.sh keeps a record of what it deleted under Deleted Events for 30 days.",
    label: "Two-way, including deletions",
    mode: "edits_and_deletes",
  },
];

function WriteBackFieldSummary({ sourceName }: { sourceName: string }) {
  const excludeEventName = useAtomValue(excludeEventNameAtom);
  const excludeEventDescription = useAtomValue(excludeFieldAtoms.excludeEventDescription);
  const excludeEventLocation = useAtomValue(excludeFieldAtoms.excludeEventLocation);
  const summary = buildWriteBackFieldSummary(
    { excludeEventDescription, excludeEventLocation, excludeEventName },
    sourceName,
  );

  const caveats = [
    summary.conflict,
    summary.hidden,
    "Only the fields you actually change are written back, and repeating events stay one-way.",
    summary.adopted,
    summary.batch,
    summary.repeated,
  ].filter((caveat) => caveat !== null);

  return (
    <div className="flex flex-col gap-1">
      <Text size="xs">{summary.written}</Text>
      <Collapsible
        className="-mx-4"
        trigger={<Text size="xs">{`When an edit will not reach ${sourceName}`}</Text>}
      >
        <div className="flex flex-col gap-2">
          {caveats.map((caveat) => <Text key={caveat} size="xs">{caveat}</Text>)}
        </div>
      </Collapsible>
    </div>
  );
}

function WriteBackModeControl({
  calendarId,
  destinationId,
  destinationName,
}: {
  calendarId: string;
  destinationId: string;
  destinationName: string;
}) {
  const store = useStore();
  const { mutate } = useSWRConfig();
  const { data: entitlements } = useEntitlements();
  const modeAtom = useMemo(() => selectWriteBackMode(destinationId), [destinationId]);
  const mode = useAtomValue(modeAtom);
  const sourceName = useAtomValue(calendarNameAtom);
  const stateAtom = useMemo(() => selectWriteBackState(destinationId), [destinationId]);
  const status = useAtomValue(stateAtom);
  const siblingCountAtom = useMemo(
    () => selectSiblingDestinationCount(destinationId),
    [destinationId],
  );
  const siblingCount = useAtomValue(siblingCountAtom);
  const [pendingDeletionConsent, setPendingDeletionConsent] = useState(false);
  const locked = Boolean(entitlements && !entitlements.canUseTwoWaySync);
  const calendarDetail = useAtomValue(calendarDetailAtom);
  const writableSource = supportsWriteBack(calendarDetail);

  const applyMode = (nextMode: WriteBackMode) => {
    const selection = resolveModeSelection({
      locked,
      nextMode,
      selectedMode: mode,
      status,
      writableSource,
    });
    if (selection === "ignore") {
      return;
    }
    if (selection === "confirm_deletions") {
      setPendingDeletionConsent(true);
      return;
    }
    commitMode(nextMode);
  };

  /*
   * The pass asked a question and paused rather than deleting anything. Answering it is
   * the only way through: re-picking the mode the pair already carries is a no-op, so the
   * held deletions would otherwise be unreachable.
   */
  const resolveDeleteConfirmation = (decision: DeleteConfirmationAnswer) => {
    track(ANALYTICS_EVENTS.write_back_mode_changed, {
      deletions: decision !== "decline",
      mode,
    });
    const swrKey = `/api/sources/${calendarId}/destinations`;
    serializedCall(swrKey, () =>
      apiFetch(`${swrKey}/${destinationId}/delete-confirmation`, {
        body: JSON.stringify({ decision }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      }).finally(() => {
        void mutate(swrKey);
      }));
  };

  const commitMode = (nextMode: WriteBackMode) => {
    track(ANALYTICS_EVENTS.write_back_mode_changed, {
      deletions: nextMode === "edits_and_deletes",
      mode: nextMode,
    });

    const previousModes = store.get(writeBackModesAtom);
    store.set(writeBackModesAtom, { ...previousModes, [destinationId]: nextMode });

    const swrKey = `/api/sources/${calendarId}/destinations`;
    serializedCall(swrKey, () =>
      apiFetch(`${swrKey}/${destinationId}`, {
        body: JSON.stringify({ writeBackMode: nextMode }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      }).catch(() => {
        store.set(writeBackModesAtom, previousModes);
      }).finally(() => {
        void mutate(swrKey);
      }));
  };

  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-wrap gap-1">
        {WRITE_BACK_OPTIONS.map((option) => (
          <Button
            key={option.mode}
            type="button"
            size="compact"
            variant={resolveWriteBackOptionVariant(option.mode === mode)}
            disabled={(locked || !writableSource) && option.mode !== "off"}
            onClick={() => { applyMode(option.mode); }}
          >
            {option.label}
          </Button>
        ))}
      </div>
      <Text size="xs">
        {WRITE_BACK_OPTIONS.find((option) => option.mode === mode)?.description}
      </Text>
      {mode !== "off" && (
        <WriteBackFieldSummary sourceName={sourceName || "this calendar"} />
      )}
      {!writableSource && (
        <Text size="xs">
          {resolveUnwritableSourceCopy(calendarDetail)}
        </Text>
      )}
      {locked && writableSource && <UpgradeHint>Two-way sync is a Pro feature.</UpgradeHint>}
      <WriteBackStatusLine
        destinationName={destinationName}
        onResolveDeleteConfirmation={resolveDeleteConfirmation}
        sourceName={sourceName || "this calendar"}
        status={status}
      />
      <Text size="xs">
        {`Copies live on ${destinationName}.`}
      </Text>
      {pendingDeletionConsent && (
        <DeletionConsentModal
          destinationName={destinationName}
          onCancel={() => { setPendingDeletionConsent(false); }}
          onConfirm={() => {
            setPendingDeletionConsent(false);
            commitMode("edits_and_deletes");
          }}
          siblingCount={siblingCount}
          sourceName={sourceName || "this calendar"}
        />
      )}
    </div>
  );
}


const ANSWER_LABELS: Record<DeleteConfirmationAnswer, (sourceName: string) => string> = {
  apply: (sourceName) => `Delete the originals on ${sourceName}`,
  apply_empty_destination: (sourceName) =>
    `I emptied it myself — delete the originals on ${sourceName}`,
  decline: () => "Put the copies back",
};

function WriteBackStatusLine({
  destinationName,
  onResolveDeleteConfirmation,
  sourceName,
  status,
}: {
  destinationName: string;
  onResolveDeleteConfirmation: (decision: DeleteConfirmationAnswer) => void;
  sourceName: string;
  status: WriteBackStatus | null;
}) {
  if (!status || status.state === "ok") {
    return null;
  }
  const template = resolveWriteBackStateCopy(
    status,
    `Two-way sync to ${destinationName} is paused.`,
  );
  const answers = resolveDeleteConfirmationAnswers(status);

  return (
    <div className="flex flex-col gap-2">
      <Text size="xs" className="text-destructive">
        {template.split("{destination}").join(destinationName)
          .split("{source}").join(sourceName)}
      </Text>
      {answers.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {answers.map((answer) => (
            <Button
              key={answer}
              type="button"
              size="compact"
              variant={resolveDeleteAnswerVariant(answer)}
              onClick={() => { onResolveDeleteConfirmation(answer); }}
            >
              {ANSWER_LABELS[answer](sourceName)}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

function DeletionConsentModal({
  destinationName,
  onCancel,
  onConfirm,
  siblingCount,
  sourceName,
}: {
  destinationName: string;
  onCancel: () => void;
  onConfirm: () => void;
  siblingCount: number;
  sourceName: string;
}) {
  const [acknowledged, setAcknowledged] = useState(false);

  return (
    <Modal open onOpenChange={(next) => { if (!next) onCancel(); }}>
      <ModalContent>
        <ModalTitle>Propagate deletions?</ModalTitle>
        <ModalDescription>
          {`Deleting a copy on ${destinationName} will permanently delete the original on `}
          {sourceName}
          {siblingCount > 0
            ? ` — and remove it from the ${siblingCount} other calendar${siblingCount === 1 ? "" : "s"} it is copied to.`
            : "."}
          {" Keeper.sh never deletes or moves an original that other people are invited to,"}
          {" and keeps a record of what it did delete — title, time, place and description —"}
          {" for 30 days."}
        </ModalDescription>
        <Link className="text-xs underline underline-offset-2" to="/dashboard/deleted-events">
          See the record of deleted events
        </Link>
        <label className="flex items-start gap-2 text-xs">
          <input
            checked={acknowledged}
            onChange={(event) => { setAcknowledged(event.target.checked); }}
            type="checkbox"
          />
          <span>
            {`I understand deleting a copy deletes the real event on ${sourceName}.`}
          </span>
        </label>
        <ModalFooter>
          <Button disabled={!acknowledged} onClick={onConfirm}>
            Turn on deletion propagation
          </Button>
          <Button onClick={onCancel} variant="ghost">Cancel</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

const resolveWriteBackOptionVariant = (selected: boolean): ButtonProps["variant"] => {
  if (selected) {
    return "border";
  }
  return "ghost";
};

const resolveDeleteAnswerVariant = (
  answer: DeleteConfirmationAnswer,
): ButtonProps["variant"] => {
  switch (answer) {
    case "decline":
      return "border";
    default:
      return "destructive";
  }
};

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
  const { data: entitlements } = useEntitlements();
  const locked = Boolean(entitlements && !entitlements.canUseEventFilters);
  const calendarType = useAtomValue(calendarTypeAtom);

  return (
    <>
      <DashboardSection
        title="Sync Settings"
        description={<>Choose which event details are synced to destination calendars. Use <Text as="span" size="sm" className="text-template inline">{"{{calendar_name}}"}</Text> or <Text as="span" size="sm" className="text-template inline">{"{{event_name}}"}</Text> in text fields for dynamic values.</>}
      />
      <PremiumFeatureGate locked={locked} hint="Advanced sync settings are a Pro feature.">
        <NavigationMenu>
          <SyncEventNameTemplateItem calendarId={calendarId} locked={locked} />
          <SyncEventNameToggle calendarId={calendarId} locked={locked} />
          <ProviderSyncSettings calendarId={calendarId} calendarType={calendarType} locked={locked} />
          {SYNC_SETTINGS.map((setting) => (
            <ExcludeFieldToggle
              key={setting.field}
              calendarId={calendarId}
              field={setting.field}
              label={setting.label}
              matchesField={setting.matchesField}
              locked={locked}
            />
          ))}
        </NavigationMenu>
      </PremiumFeatureGate>
    </>
  );
}

function ProviderSyncSettings({
  calendarId,
  calendarType,
  locked,
}: {
  calendarId: string;
  calendarType: string;
  locked: boolean;
}) {
  switch (calendarType) {
    case "ical":
      return <TreatFullDayTimedEventsToggle calendarId={calendarId} locked={locked} />;
    default:
      return null;
  }
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

function SyncEventNameDisabledProvider({ locked, children }: { locked: boolean; children: React.ReactNode }) {
  const excludeEventName = useAtomValue(excludeEventNameAtom);
  return <ItemDisabledContext value={locked || !excludeEventName}>{children}</ItemDisabledContext>;
}

function SyncEventNameTemplateItem({ calendarId, locked }: { calendarId: string; locked: boolean }) {
  const store = useStore();
  const customEventName = useAtomValue(customEventNameAtom);

  return (
    <SyncEventNameDisabledProvider locked={locked}>
      <NavigationMenuEditableTemplateItem
        label="Event Name"
        disabled={locked}
        value={customEventName || "{{event_name}}"}
        renderInput={(live) => (
          <SyncEventNameTemplateInput template={live} />
        )}
        onCommit={(customEventName) => {
          store.set(calendarDetailAtom, (prev) => (prev ? { ...prev, customEventName } : prev));
          patchSource(store, calendarId, { customEventName });
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

function SyncEventNameToggle({ calendarId, locked }: { calendarId: string; locked: boolean }) {
  const store = useStore();
  const variant = use(MenuVariantContext);

  const handleClick = () => {
    if (locked) return;
    const current = store.get(calendarDetailAtom);
    if (!current) return;

    const patch = current.excludeEventName
      ? { excludeEventName: false, customEventName: "{{event_name}}" }
      : { excludeEventName: true, customEventName: "{{calendar_name}}" };

    track(ANALYTICS_EVENTS.calendar_setting_toggled, { field: "excludeEventName", enabled: !current.excludeEventName });
    store.set(calendarDetailAtom, (prev) => (prev ? { ...prev, ...patch } : prev));
    patchSource(store, calendarId, patch);
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
          <NavigationMenuItemLabel>Sync Event Name</NavigationMenuItemLabel>
          <SyncEventNameToggleIndicator disabled={locked} />
        </button>
      </ItemDisabledContext>
    </li>
  );
}

function SyncEventNameToggleIndicator({ disabled }: { disabled: boolean }) {
  const excludeEventName = useAtomValue(excludeEventNameAtom);
  const variant = use(MenuVariantContext);
  const checked = !excludeEventName;

  return (
    <div className={navigationMenuToggleTrack({ variant, checked, disabled, className: "ml-auto" })}>
      <div className={navigationMenuToggleThumb({ variant, checked })} />
    </div>
  );
}

function ExclusionsSection({ calendarId, provider }: { calendarId: string; provider: string }) {
  const { data: entitlements } = useEntitlements();
  const locked = entitlements ? !entitlements.canUseEventFilters : false;
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
      <PremiumFeatureGate locked={locked} hint="Event exclusions are a Pro feature.">
        <NavigationMenu>
          {exclusionSettings.map((setting) => (
            <ExcludeFieldToggle
              key={setting.field}
              calendarId={calendarId}
              field={setting.field}
              label={setting.label}
              matchesField={setting.matchesField}
              locked={locked}
            />
          ))}
        </NavigationMenu>
      </PremiumFeatureGate>
    </>
  );
}

function ExcludeFieldToggle({
  calendarId,
  field,
  label,
  matchesField,
  locked = false,
}: {
  calendarId: string;
  field: ExcludeField;
  label: string;
  matchesField: boolean;
  locked?: boolean;
}) {
  const store = useStore();
  const variant = use(MenuVariantContext);

  const handleClick = () => {
    if (locked) return;
    const current = store.get(calendarDetailAtom);
    if (!current) return;

    const newValue = !current[field];
    track(ANALYTICS_EVENTS.calendar_setting_toggled, { field, enabled: newValue });
    store.set(calendarDetailAtom, (prev) => (prev ? { ...prev, [field]: newValue } : prev));
    patchSource(store, calendarId, { [field]: newValue });
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
          <NavigationMenuItemLabel>{label}</NavigationMenuItemLabel>
          <ExcludeFieldToggleIndicator field={field} matchesField={matchesField} disabled={locked} />
        </button>
      </ItemDisabledContext>
    </li>
  );
}

function ExcludeFieldToggleIndicator({ field, matchesField, disabled }: { field: ExcludeField; matchesField: boolean; disabled: boolean }) {
  const raw = useAtomValue(excludeFieldAtoms[field]);
  const variant = use(MenuVariantContext);
  const checked = matchesField ? raw : !raw;

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
