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

export const Route = createFileRoute(
  "/(dashboard)/dashboard/accounts/$accountId/setup",
)({
  component: AccountSetupPage,
});

type Step =
  | { type: "select" }
  | { type: "rename" }
  | { type: "destinations"; calendarIndex: number }
  | { type: "sources"; calendarIndex: number };

function AccountSetupPage() {
  const { accountId } = Route.useParams();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>({ type: "select" });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const { data: allCalendars, isLoading, error, mutate: mutateCalendars } = useSWR<CalendarSource[]>(
    "/api/sources",
  );

  const accountCalendars = (allCalendars ?? []).filter(
    (calendar) => calendar.accountId === accountId,
  );

  const selectedCalendars = accountCalendars.filter((c) => selectedIds.has(c.id));
  const pullCapableSelected = selectedCalendars.filter(canPull);
  const pushCapableSelected = selectedCalendars.filter(canPush);

  const handleToggleSelect = (calendarId: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(calendarId);
      else next.delete(calendarId);
      return next;
    });
  };

  const advanceToSources = () => {
    if (pushCapableSelected.length > 0) {
      setStep({ type: "sources", calendarIndex: 0 });
    } else {
      navigate({ to: "/dashboard" });
    }
  };

  const advanceFromRename = () => {
    if (pullCapableSelected.length > 0) {
      setStep({ type: "destinations", calendarIndex: 0 });
    } else {
      advanceToSources();
    }
  };

  const advanceFromDestinations = (currentIndex: number) => {
    const nextIndex = currentIndex + 1;
    if (nextIndex < pullCapableSelected.length) {
      setStep({ type: "destinations", calendarIndex: nextIndex });
    } else {
      advanceToSources();
    }
  };

  const advanceFromSources = (currentIndex: number) => {
    const nextIndex = currentIndex + 1;
    if (nextIndex < pushCapableSelected.length) {
      setStep({ type: "sources", calendarIndex: nextIndex });
    } else {
      navigate({ to: "/dashboard" });
    }
  };

  if (error || isLoading) {
    return <RouteShell backFallback="/dashboard" isLoading={isLoading} error={error} onRetry={() => mutateCalendars()}>{null}</RouteShell>;
  }

  return (
    <div className="flex flex-col gap-1.5">
      <BackButton fallback="/dashboard" />
      {step.type === "select" && (
        <SelectSection
          calendars={accountCalendars}
          selectedIds={selectedIds}
          onToggle={handleToggleSelect}
          onNext={() => setStep({ type: "rename" })}
        />
      )}
      {step.type === "rename" && (
        <RenameSection
          calendars={selectedCalendars}
          mutateCalendars={mutateCalendars}
          onNext={advanceFromRename}
        />
      )}
      {step.type === "destinations" && (
        <DestinationsSection
          calendar={pullCapableSelected[step.calendarIndex]}
          allCalendars={allCalendars ?? []}
          onNext={() => advanceFromDestinations(step.calendarIndex)}
        />
      )}
      {step.type === "sources" && (
        <SourcesSection
          calendar={pushCapableSelected[step.calendarIndex]}
          allCalendars={allCalendars ?? []}
          onNext={() => advanceFromSources(step.calendarIndex)}
        />
      )}
    </div>
  );
}

function SelectSection({
  calendars,
  selectedIds,
  onToggle,
  onNext,
}: {
  calendars: CalendarSource[];
  selectedIds: Set<string>;
  onToggle: (calendarId: string, checked: boolean) => void;
  onNext: () => void;
}) {
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
            checked={selectedIds.has(calendar.id)}
            onCheckedChange={(checked) => onToggle(calendar.id, checked)}
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
          disabled={selectedIds.size === 0}
          onClick={onNext}
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
        return current?.map((c) =>
          c.id === calendarId ? { ...c, name } : c,
        );
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
      {calendars.map((calendar, index) => (
        <NavigationMenu key={calendar.id}>
          <NavigationMenuEditableItem
            value={calendar.name}
            autoEdit={index === 0}
            onCommit={(name) => handleRename(calendar.id, name)}
          />
        </NavigationMenu>
      ))}
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
    (c) => canPush(c) && c.id !== calendar.id,
  );

  const selectedDestinationIds = new Set(destinationsData?.destinationIds ?? []);

  const handleToggle = async (destinationId: string, checked: boolean) => {
    const currentIds = destinationsData?.destinationIds ?? [];
    const updatedIds = checked
      ? [...currentIds, destinationId]
      : currentIds.filter((id) => id !== destinationId);

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
        <DashboardHeading2 className="overflow-visible text-wrap whitespace-normal">Where should '{calendar.name}' send events?</DashboardHeading2>
        <Text size="sm">Select which calendars should receive events from this calendar.</Text>
      </div>
      <NavigationMenu>
        {pushCalendars.length === 0 ? (
          <NavigationMenuEmptyItem>No destination calendars available</NavigationMenuEmptyItem>
        ) : (
          pushCalendars.map((dest) => (
            <NavigationMenuCheckboxItem
              key={dest.id}
              checked={selectedDestinationIds.has(dest.id)}
              onCheckedChange={(checked) => handleToggle(dest.id, checked)}
            >
              <NavigationMenuItemIcon>
                <ProviderIcon
                  provider={getCalendarProvider(dest)}
                  calendarType={dest.calendarType}
                />
              </NavigationMenuItemIcon>
              <NavigationMenuItemLabel>{dest.name}</NavigationMenuItemLabel>
            </NavigationMenuCheckboxItem>
          ))
        )}
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
    (c) => canPull(c) && c.id !== calendar.id,
  );

  const selectedSourceIds = new Set(sourcesData?.sourceIds ?? []);

  const handleToggle = async (sourceId: string, checked: boolean) => {
    const currentIds = sourcesData?.sourceIds ?? [];
    const updatedIds = checked
      ? [...currentIds, sourceId]
      : currentIds.filter((id) => id !== sourceId);

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
        <DashboardHeading2 className="overflow-visible text-wrap whitespace-normal">Where should '{calendar.name}' pull events from?</DashboardHeading2>
        <Text size="sm">Select which calendars should send events to this calendar.</Text>
      </div>
      <NavigationMenu>
        {pullCalendars.length === 0 ? (
          <NavigationMenuEmptyItem>No source calendars available</NavigationMenuEmptyItem>
        ) : (
          pullCalendars.map((source) => (
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
          ))
        )}
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
