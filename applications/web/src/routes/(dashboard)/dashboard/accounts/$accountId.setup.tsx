import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import useSWR from "swr";
import { BackButton } from "../../../../components/ui/primitives/back-button";
import { UpgradeHint } from "../../../../components/ui/primitives/upgrade-hint";
import { DashboardSection } from "../../../../components/ui/primitives/dashboard-heading";
import { Button, LinkButton, ButtonText } from "../../../../components/ui/primitives/button";
import { apiFetch } from "../../../../lib/fetcher";
import { useEntitlements, useMutateEntitlements, canAddMore } from "../../../../hooks/use-entitlements";
import type { CalendarSource } from "../../../../types/api";
import {
  NavigationMenu,
  NavigationMenuCheckboxItem,
  NavigationMenuEmptyItem,
  NavigationMenuItemIcon,
  NavigationMenuItemLabel,
} from "../../../../components/ui/composites/navigation-menu/navigation-menu-items";
import { NavigationMenuEditableItem } from "../../../../components/ui/composites/navigation-menu/navigation-menu-editable";
import { ProviderIcon } from "../../../../components/ui/primitives/provider-icon";
import { RouteShell } from "../../../../components/ui/shells/route-shell";
import { canPull, canPush, getCalendarProvider } from "../../../../utils/calendars";
import { resolveUpdatedIds } from "../../../../utils/collections";

const VALID_STEPS = ["select", "rename", "destinations", "sources"] as const;
type SetupStep = (typeof VALID_STEPS)[number];

interface SetupSearch {
  step?: SetupStep;
  id?: string;
  index?: number;
}

type MappingRoute = "destinations" | "sources";
type MappingResponseKey = "destinationIds" | "sourceIds";
type CalendarMappingData = Partial<Record<MappingResponseKey, string[]>>;

function isValidStep(value: unknown): value is SetupStep {
  const validSteps: readonly string[] = VALID_STEPS;
  return typeof value === "string" && validSteps.includes(value);
}

function parseSearchIndex(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isInteger(parsed) || parsed < 0) return undefined;
  return parsed;
}

export const Route = createFileRoute(
  "/(dashboard)/dashboard/accounts/$accountId/setup",
)({
  component: AccountSetupPage,
  validateSearch: (search: Record<string, unknown>): SetupSearch => {
    return {
      step: isValidStep(search.step) ? search.step : undefined,
      id: typeof search.id === "string" ? search.id : undefined,
      index: parseSearchIndex(search.index),
    };
  },
});

function parseSelectedIds(commaIds: string | undefined): Set<string> {
  if (!commaIds) return new Set();
  return new Set(commaIds.split(",").filter(Boolean));
}

function resolveStepCalendarIndex(index: number, count: number): number {
  if (count === 0) return 0;
  if (index >= count) return count - 1;
  return index;
}

interface SetupWorkflowData {
  accountCalendars: CalendarSource[];
  selectedCalendars: CalendarSource[];
  destinationCalendars: CalendarSource[];
  sourceCalendars: CalendarSource[];
  destinationCalendarIndex: number;
  sourceCalendarIndex: number;
}

function resolveSetupWorkflowData({
  allCalendars,
  accountId,
  selectedIds,
  requestedCalendarIndex,
}: {
  allCalendars: CalendarSource[];
  accountId: string;
  selectedIds: Set<string>;
  requestedCalendarIndex: number;
}): SetupWorkflowData {
  const accountCalendars = allCalendars.filter((calendar) => calendar.accountId === accountId);
  const selectedCalendars = accountCalendars.filter((calendar) => selectedIds.has(calendar.id));
  const destinationCalendars = selectedCalendars.filter(canPull);
  const sourceCalendars = selectedCalendars.filter(canPush);

  return {
    accountCalendars,
    selectedCalendars,
    destinationCalendars,
    sourceCalendars,
    destinationCalendarIndex: resolveStepCalendarIndex(requestedCalendarIndex, destinationCalendars.length),
    sourceCalendarIndex: resolveStepCalendarIndex(requestedCalendarIndex, sourceCalendars.length),
  };
}

function resolveNextIndex(currentIndex: number, totalCount: number): number | undefined {
  const nextIndex = currentIndex + 1;
  if (nextIndex < totalCount) return nextIndex;
  return undefined;
}

interface SetupStepActions {
  advanceFromRename: () => void;
  advanceFromDestinations: (currentIndex: number) => void;
  advanceFromSources: (currentIndex: number) => void;
}

function createSetupStepActions({
  destinationCount,
  sourceCount,
  navigateToStep,
  navigateToDashboard,
}: {
  destinationCount: number;
  sourceCount: number;
  navigateToStep: (step: SetupStep, index?: number) => void;
  navigateToDashboard: () => void;
}): SetupStepActions {
  const advanceToSources = () => {
    if (sourceCount > 0) {
      navigateToStep("sources", 0);
      return;
    }
    navigateToDashboard();
  };

  return {
    advanceFromRename: () => {
      if (destinationCount > 0) {
        navigateToStep("destinations", 0);
        return;
      }
      advanceToSources();
    },
    advanceFromDestinations: (currentIndex: number) => {
      const nextIndex = resolveNextIndex(currentIndex, destinationCount);
      if (nextIndex !== undefined) {
        navigateToStep("destinations", nextIndex);
        return;
      }
      advanceToSources();
    },
    advanceFromSources: (currentIndex: number) => {
      const nextIndex = resolveNextIndex(currentIndex, sourceCount);
      if (nextIndex !== undefined) {
        navigateToStep("sources", nextIndex);
        return;
      }
      navigateToDashboard();
    },
  };
}

function SetupStepContent({
  step,
  accountId,
  allCalendars,
  workflow,
  mutateCalendars,
  actions,
}: {
  step: SetupStep;
  accountId: string;
  allCalendars: CalendarSource[];
  workflow: SetupWorkflowData;
  mutateCalendars: ReturnType<typeof useSWR<CalendarSource[]>>["mutate"];
  actions: SetupStepActions;
}) {
  if (step === "select") {
    return (
      <SelectSection
        accountId={accountId}
        calendars={workflow.accountCalendars}
      />
    );
  }

  if (step === "rename") {
    return (
      <RenameSection
        calendars={workflow.selectedCalendars}
        mutateCalendars={mutateCalendars}
        onNext={actions.advanceFromRename}
      />
    );
  }

  if (step === "destinations") {
    const calendar = workflow.destinationCalendars[workflow.destinationCalendarIndex];
    const onNext = () => actions.advanceFromDestinations(workflow.destinationCalendarIndex);
    if (!calendar) return <EmptyStepSection heading="No destination setup needed" message="None of the selected calendars can send events right now." buttonLabel="Continue" onNext={onNext} />;
    return <DestinationsSection calendar={calendar} allCalendars={allCalendars} onNext={onNext} />;
  }

  const calendar = workflow.sourceCalendars[workflow.sourceCalendarIndex];
  const onNext = () => actions.advanceFromSources(workflow.sourceCalendarIndex);
  if (!calendar) return <EmptyStepSection heading="No source setup needed" message="None of the selected calendars can pull events right now." buttonLabel="Finish" onNext={onNext} />;
  return <SourcesSection calendar={calendar} allCalendars={allCalendars} onNext={onNext} />;
}

function buildMappingData(responseKey: MappingResponseKey, ids: string[]): CalendarMappingData {
  return { [responseKey]: ids };
}

function useCalendarMapping({
  calendarId,
  route,
  responseKey,
}: {
  calendarId?: string;
  route: MappingRoute;
  responseKey: MappingResponseKey;
}) {
  const endpoint = calendarId ? `/api/sources/${calendarId}/${route}` : null;
  const { data, mutate } = useSWR<CalendarMappingData>(endpoint);
  const { adjustMappingCount, revalidateEntitlements } = useMutateEntitlements();

  const selectedIds = new Set(data?.[responseKey] ?? []);

  const handleToggle = async (targetCalendarId: string, checked: boolean) => {
    if (!endpoint) return;
    const currentIds = data?.[responseKey] ?? [];
    const updatedIds = resolveUpdatedIds(currentIds, targetCalendarId, checked);
    const mappingData = buildMappingData(responseKey, updatedIds);
    const delta = checked ? 1 : -1;

    adjustMappingCount(delta);

    try {
      await mutate(
        async () => {
          await apiFetch(endpoint, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ calendarIds: updatedIds }),
          });
          return mappingData;
        },
        {
          optimisticData: mappingData,
          rollbackOnError: true,
          revalidate: false,
        },
      );
    } catch {
      adjustMappingCount(-delta);
    } finally {
      void revalidateEntitlements();
    }
  };

  return { selectedIds, handleToggle };
}

function AccountSetupPage() {
  const { accountId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();

  const step = search.step ?? "select";
  const selectedIds = parseSelectedIds(search.id);
  const requestedCalendarIndex = search.index ?? 0;

  const { data, isLoading, error, mutate: mutateCalendars } = useSWR<CalendarSource[]>("/api/sources");
  const allCalendars = data ?? [];
  const workflow = resolveSetupWorkflowData({
    allCalendars,
    accountId,
    selectedIds,
    requestedCalendarIndex,
  });

  const navigateToStep = (nextStep: SetupStep, nextIndex?: number) => {
    navigate({
      to: "/dashboard/accounts/$accountId/setup",
      params: { accountId },
      search: { step: nextStep, id: search.id, index: nextIndex },
    });
  };

  const actions = createSetupStepActions({
    destinationCount: workflow.destinationCalendars.length,
    sourceCount: workflow.sourceCalendars.length,
    navigateToStep,
    navigateToDashboard: () => navigate({ to: "/dashboard" }),
  });

  if (error || isLoading) {
    if (error) return <RouteShell backFallback="/dashboard" status="error" onRetry={() => mutateCalendars()} />;
    return <RouteShell backFallback="/dashboard" status="loading" />;
  }

  return (
    <div className="flex flex-col gap-1.5">
      <BackButton fallback="/dashboard" />
      <SetupStepContent
        step={step}
        accountId={accountId}
        allCalendars={allCalendars}
        workflow={workflow}
        mutateCalendars={mutateCalendars}
        actions={actions}
      />
    </div>
  );
}

function SelectSection({
  accountId,
  calendars,
}: {
  accountId: string;
  calendars: CalendarSource[];
}) {
  const navigate = useNavigate();
  const [localSelectedIds, setLocalSelectedIds] = useState<Set<string>>(new Set());

  const handleToggle = (calendarId: string, checked: boolean) => {
    setLocalSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(calendarId);
      } else {
        next.delete(calendarId);
      }
      return next;
    });
  };

  const handleNext = () => {
    navigate({
      to: "/dashboard/accounts/$accountId/setup",
      params: { accountId },
      search: { step: "rename", id: [...localSelectedIds].join(",") },
    });
  };

  return (
    <>
      <DashboardSection
        title="Which calendars would you like to configure?"
        description="Select the calendars you want to rename and set up."
      />
      <NavigationMenu>
        {calendars.map((calendar) => (
          <NavigationMenuCheckboxItem
            key={calendar.id}
            checked={localSelectedIds.has(calendar.id)}
            onCheckedChange={(checked) => handleToggle(calendar.id, checked)}
          >
            <NavigationMenuItemIcon>
              <ProviderIcon
                provider={getCalendarProvider(calendar)}
                calendarType={calendar.calendarType}
              />
            </NavigationMenuItemIcon>
            <NavigationMenuItemLabel>{calendar.name}</NavigationMenuItemLabel>
          </NavigationMenuCheckboxItem>
        ))}
      </NavigationMenu>
      <div className="flex flex-col gap-1.5">
        <Button
          className="w-full justify-center"
          disabled={localSelectedIds.size === 0}
          onClick={handleNext}
        >
          <ButtonText>Next</ButtonText>
        </Button>
        <LinkButton
          to="/dashboard"
          variant="ghost"
          className="w-full justify-center"
        >
          <ButtonText>Skip</ButtonText>
        </LinkButton>
      </div>
    </>
  );
}

function RenameSection({
  calendars,
  mutateCalendars,
  onNext,
}: {
  calendars: CalendarSource[];
  mutateCalendars: ReturnType<typeof useSWR<CalendarSource[]>>["mutate"];
  onNext: () => void;
}) {
  const handleRename = async (calendarId: string, name: string) => {
    await mutateCalendars(
      async (current) => {
        await apiFetch(`/api/sources/${calendarId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        return current?.map((calendar) =>
          calendar.id === calendarId ? { ...calendar, name } : calendar,
        );
      },
      {
        optimisticData: (current) =>
          (current ?? []).map((calendar) =>
            calendar.id === calendarId ? { ...calendar, name } : calendar,
          ),
        rollbackOnError: true,
        revalidate: false,
      },
    );
  };

  return (
    <>
      <DashboardSection
        title="Rename Your Calendars"
        description="Provider names are often generic. Click a calendar to give it a more meaningful name."
      />
      <NavigationMenu>
        {calendars.map((calendar, index) => (
          <NavigationMenuEditableItem
            key={calendar.id}
            value={calendar.name}
            defaultEditing={index === 0}
            onCommit={(name) => handleRename(calendar.id, name)}
          />
        ))}
      </NavigationMenu>
      <Button
        className="w-full justify-center"
        onClick={onNext}
      >
        <ButtonText>Next</ButtonText>
      </Button>
    </>
  );
}

function EmptyStepSection({ heading, message, buttonLabel, onNext }: {
  heading: string;
  message: string;
  buttonLabel: string;
  onNext: () => void;
}) {
  return (
    <>
      <DashboardSection title={heading} description={message} />
      <Button className="w-full justify-center" onClick={onNext}>
        <ButtonText>{buttonLabel}</ButtonText>
      </Button>
    </>
  );
}

function DestinationsSection({
  calendar,
  allCalendars,
  onNext,
}: {
  calendar: CalendarSource;
  allCalendars: CalendarSource[];
  onNext: () => void;
}) {
  const { selectedIds, handleToggle } = useCalendarMapping({
    calendarId: calendar.id,
    route: "destinations",
    responseKey: "destinationIds",
  });
  const { data: entitlements } = useEntitlements();
  const atLimit = !canAddMore(entitlements?.mappings);

  const pushCalendars = allCalendars.filter(
    (candidate) => canPush(candidate) && candidate.id !== calendar.id,
  );

  return (
    <>
      <DashboardSection
        title={<>Where should &apos;{calendar.name}&apos; send events?</>}
        description="Select which calendars should receive events from this calendar."
        headingClassName="overflow-visible text-wrap whitespace-normal"
      />
      <NavigationMenu>
        {pushCalendars.length === 0 && (
          <NavigationMenuEmptyItem>No destination calendars available</NavigationMenuEmptyItem>
        )}
        {pushCalendars.map((destination) => {
          const checked = selectedIds.has(destination.id);
          const disabled = atLimit && !checked;
          return (
            <NavigationMenuCheckboxItem
              key={destination.id}
              checked={checked}
              disabled={disabled}
              onCheckedChange={(next) => !disabled && handleToggle(destination.id, next)}
            >
              <NavigationMenuItemIcon>
                <ProviderIcon
                  provider={getCalendarProvider(destination)}
                  calendarType={destination.calendarType}
                />
              </NavigationMenuItemIcon>
              <NavigationMenuItemLabel>{destination.name}</NavigationMenuItemLabel>
            </NavigationMenuCheckboxItem>
          );
        })}
      </NavigationMenu>
      {atLimit && <UpgradeHint>Mapping limit reached.</UpgradeHint>}
      <Button
        className="w-full justify-center"
        onClick={onNext}
      >
        <ButtonText>Next</ButtonText>
      </Button>
    </>
  );
}

function SourcesSection({
  calendar,
  allCalendars,
  onNext,
}: {
  calendar: CalendarSource;
  allCalendars: CalendarSource[];
  onNext: () => void;
}) {
  const { selectedIds, handleToggle } = useCalendarMapping({
    calendarId: calendar.id,
    route: "sources",
    responseKey: "sourceIds",
  });
  const { data: entitlements } = useEntitlements();
  const atLimit = !canAddMore(entitlements?.mappings);

  const pullCalendars = allCalendars.filter(
    (candidate) => canPull(candidate) && candidate.id !== calendar.id,
  );

  return (
    <>
      <DashboardSection
        title={<>Where should &apos;{calendar.name}&apos; pull events from?</>}
        description="Select which calendars should send events to this calendar."
        headingClassName="overflow-visible text-wrap whitespace-normal"
      />
      <NavigationMenu>
        {pullCalendars.length === 0 && (
          <NavigationMenuEmptyItem>No source calendars available</NavigationMenuEmptyItem>
        )}
        {pullCalendars.map((source) => {
          const checked = selectedIds.has(source.id);
          const disabled = atLimit && !checked;
          return (
            <NavigationMenuCheckboxItem
              key={source.id}
              checked={checked}
              disabled={disabled}
              onCheckedChange={(next) => !disabled && handleToggle(source.id, next)}
            >
              <NavigationMenuItemIcon>
                <ProviderIcon
                  provider={getCalendarProvider(source)}
                  calendarType={source.calendarType}
                />
              </NavigationMenuItemIcon>
              <NavigationMenuItemLabel>{source.name}</NavigationMenuItemLabel>
            </NavigationMenuCheckboxItem>
          );
        })}
      </NavigationMenu>
      {atLimit && <UpgradeHint>Mapping limit reached.</UpgradeHint>}
      <Button
        className="w-full justify-center"
        onClick={onNext}
      >
        <ButtonText>Next</ButtonText>
      </Button>
    </>
  );
}
