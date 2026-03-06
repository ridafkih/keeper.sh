import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import useSWR from "swr";
import { BackButton } from "../../../../components/ui/back-button";
import { Text } from "../../../../components/ui/text";
import { DashboardHeading2 } from "../../../../components/ui/dashboard-heading";
import { Button, LinkButton, ButtonText } from "../../../../components/ui/button";
import { apiFetch } from "../../../../lib/fetcher";
import type { CalendarSource } from "../../../../types/api";
import {
  NavigationMenu,
  NavigationMenuCheckboxItem,
  NavigationMenuEditableItem,
  NavigationMenuEmptyItem,
  NavigationMenuItemIcon,
  NavigationMenuItemLabel,
} from "../../../../components/ui/navigation-menu";
import { ProviderIcon } from "../../../../components/ui/provider-icon";
import { RouteShell } from "../../../../components/ui/route-shell";
import { canPull, canPush, getCalendarProvider } from "../../../../utils/calendars";

const VALID_STEPS = ["select", "rename", "destinations", "sources"] as const;
type SetupStep = (typeof VALID_STEPS)[number];

interface SetupSearch {
  step?: SetupStep;
  id?: string;
  index?: number;
}

function isValidStep(value: unknown): value is SetupStep {
  return typeof value === "string" && VALID_STEPS.includes(value as SetupStep);
}

export const Route = createFileRoute(
  "/(dashboard)/dashboard/accounts/$accountId/setup",
)({
  component: AccountSetupPage,
  validateSearch: (search: Record<string, unknown>): SetupSearch => {
    return {
      step: isValidStep(search.step) ? search.step : undefined,
      id: typeof search.id === "string" ? search.id : undefined,
      index: typeof search.index === "number" ? search.index : undefined,
    };
  },
});

function parseSelectedIds(commaIds: string | undefined): Set<string> {
  if (!commaIds) return new Set();
  return new Set(commaIds.split(",").filter(Boolean));
}

function AccountSetupPage() {
  const { accountId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();

  const step = search.step ?? "select";
  const selectedIds = parseSelectedIds(search.id);
  const calendarIndex = search.index ?? 0;

  const { data: allCalendars, isLoading, error, mutate: mutateCalendars } = useSWR<CalendarSource[]>(
    "/api/sources",
  );

  const accountCalendars = (allCalendars ?? []).filter(
    (calendar) => calendar.accountId === accountId,
  );

  const selectedCalendars = accountCalendars.filter((calendar) => selectedIds.has(calendar.id));
  const pullCapableSelected = selectedCalendars.filter(canPull);
  const pushCapableSelected = selectedCalendars.filter(canPush);

  const navigateToStep = (nextStep: SetupStep, nextIndex?: number) => {
    navigate({
      to: "/dashboard/accounts/$accountId/setup",
      params: { accountId },
      search: { step: nextStep, id: search.id, index: nextIndex },
    });
  };

  const advanceToSources = () => {
    if (pushCapableSelected.length > 0) {
      navigateToStep("sources", 0);
      return;
    }

    navigate({ to: "/dashboard" });
  };

  const advanceFromRename = () => {
    if (pullCapableSelected.length > 0) {
      navigateToStep("destinations", 0);
      return;
    }

    advanceToSources();
  };

  const advanceFromDestinations = (currentIndex: number) => {
    const nextIndex = currentIndex + 1;
    if (nextIndex < pullCapableSelected.length) {
      navigateToStep("destinations", nextIndex);
      return;
    }

    advanceToSources();
  };

  const advanceFromSources = (currentIndex: number) => {
    const nextIndex = currentIndex + 1;
    if (nextIndex < pushCapableSelected.length) {
      navigateToStep("sources", nextIndex);
      return;
    }

    navigate({ to: "/dashboard" });
  };

  if (error || isLoading) {
    return <RouteShell backFallback="/dashboard" isLoading={isLoading} error={error} onRetry={() => mutateCalendars()}>{null}</RouteShell>;
  }

  return (
    <div className="flex flex-col gap-1.5">
      <BackButton fallback="/dashboard" />
      {step === "select" && (
        <SelectSection
          accountId={accountId}
          calendars={accountCalendars}
        />
      )}
      {step === "rename" && (
        <RenameSection
          calendars={selectedCalendars}
          mutateCalendars={mutateCalendars}
          onNext={advanceFromRename}
        />
      )}
      {step === "destinations" && (
        <DestinationsSection
          calendar={pullCapableSelected[calendarIndex]}
          allCalendars={allCalendars ?? []}
          onNext={() => advanceFromDestinations(calendarIndex)}
        />
      )}
      {step === "sources" && (
        <SourcesSection
          calendar={pushCapableSelected[calendarIndex]}
          allCalendars={allCalendars ?? []}
          onNext={() => advanceFromSources(calendarIndex)}
        />
      )}
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
      <div className="flex flex-col px-0.5 pt-4">
        <DashboardHeading2>Which calendars would you like to configure?</DashboardHeading2>
        <Text size="sm">Select the calendars you want to rename and set up.</Text>
      </div>
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
        return current?.map((calendar) => {
          if (calendar.id === calendarId) {
            return { ...calendar, name };
          }
          return calendar;
        });
      },
      { revalidate: false },
    );
  };

  return (
    <>
      <div className="flex flex-col px-0.5 pt-4">
        <DashboardHeading2>Rename Your Calendars</DashboardHeading2>
        <Text size="sm">
          Provider names are often generic. Click a calendar to give it a more
          meaningful name.
        </Text>
      </div>
      <NavigationMenu>
        {calendars.map((calendar, index) => (
          <NavigationMenuEditableItem
            key={calendar.id}
            value={calendar.name}
            autoEdit={index === 0}
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

function DestinationsSection({
  calendar,
  allCalendars,
  onNext,
}: {
  calendar: CalendarSource;
  allCalendars: CalendarSource[];
  onNext: () => void;
}) {
  const { data: destinationsData, mutate: mutateDestinations } = useSWR<{ destinationIds: string[] }>(
    `/api/sources/${calendar.id}/destinations`,
  );

  const pushCalendars = allCalendars.filter(
    (candidate) => canPush(candidate) && candidate.id !== calendar.id,
  );

  const selectedDestinationIds = new Set(destinationsData?.destinationIds ?? []);

  const handleToggle = async (destinationId: string, checked: boolean) => {
    const currentIds = destinationsData?.destinationIds ?? [];
    const updatedIds = checked
      ? [...currentIds, destinationId]
      : currentIds.filter((existingId) => existingId !== destinationId);

    await mutateDestinations(
      async () => {
        await apiFetch(`/api/sources/${calendar.id}/destinations`, {
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
    <>
      <div className="flex flex-col px-0.5 pt-4">
        <DashboardHeading2 className="overflow-visible text-wrap whitespace-normal">Where should &apos;{calendar.name}&apos; send events?</DashboardHeading2>
        <Text size="sm">Select which calendars should receive events from this calendar.</Text>
      </div>
      <NavigationMenu>
        {pushCalendars.length === 0 && (
          <NavigationMenuEmptyItem>No destination calendars available</NavigationMenuEmptyItem>
        )}
        {pushCalendars.map((destination) => (
          <NavigationMenuCheckboxItem
            key={destination.id}
            checked={selectedDestinationIds.has(destination.id)}
            onCheckedChange={(checked) => handleToggle(destination.id, checked)}
          >
            <NavigationMenuItemIcon>
              <ProviderIcon
                provider={getCalendarProvider(destination)}
                calendarType={destination.calendarType}
              />
            </NavigationMenuItemIcon>
            <NavigationMenuItemLabel>{destination.name}</NavigationMenuItemLabel>
          </NavigationMenuCheckboxItem>
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

function SourcesSection({
  calendar,
  allCalendars,
  onNext,
}: {
  calendar: CalendarSource;
  allCalendars: CalendarSource[];
  onNext: () => void;
}) {
  const { data: sourcesData, mutate: mutateSources } = useSWR<{ sourceIds: string[] }>(
    `/api/sources/${calendar.id}/sources`,
  );

  const pullCalendars = allCalendars.filter(
    (candidate) => canPull(candidate) && candidate.id !== calendar.id,
  );

  const selectedSourceIds = new Set(sourcesData?.sourceIds ?? []);

  const handleToggle = async (sourceId: string, checked: boolean) => {
    const currentIds = sourcesData?.sourceIds ?? [];
    const updatedIds = checked
      ? [...currentIds, sourceId]
      : currentIds.filter((existingId) => existingId !== sourceId);

    await mutateSources(
      async () => {
        await apiFetch(`/api/sources/${calendar.id}/sources`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ calendarIds: updatedIds }),
        });
        return { sourceIds: updatedIds };
      },
      {
        optimisticData: { sourceIds: updatedIds },
        rollbackOnError: true,
        revalidate: false,
      },
    );
  };

  return (
    <>
      <div className="flex flex-col px-0.5 pt-4">
        <DashboardHeading2 className="overflow-visible text-wrap whitespace-normal">Where should &apos;{calendar.name}&apos; pull events from?</DashboardHeading2>
        <Text size="sm">Select which calendars should send events to this calendar.</Text>
      </div>
      <NavigationMenu>
        {pullCalendars.length === 0 && (
          <NavigationMenuEmptyItem>No source calendars available</NavigationMenuEmptyItem>
        )}
        {pullCalendars.map((source) => (
          <NavigationMenuCheckboxItem
            key={source.id}
            checked={selectedSourceIds.has(source.id)}
            onCheckedChange={(checked) => handleToggle(source.id, checked)}
          >
            <NavigationMenuItemIcon>
              <ProviderIcon
                provider={getCalendarProvider(source)}
                calendarType={source.calendarType}
              />
            </NavigationMenuItemIcon>
            <NavigationMenuItemLabel>{source.name}</NavigationMenuItemLabel>
          </NavigationMenuCheckboxItem>
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
