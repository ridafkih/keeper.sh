import { use, useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import useSWR, { useSWRConfig } from "swr";
import { atom, useAtomValue, useStore } from "jotai";
import Copy from "lucide-react/dist/esm/icons/copy";
import CheckIcon from "lucide-react/dist/esm/icons/check";
import { fetcher, apiFetch } from "../../../lib/fetcher";
import { BackButton } from "../../../components/ui/primitives/back-button";
import { Input } from "../../../components/ui/primitives/input";
import { Text } from "../../../components/ui/primitives/text";
import { DashboardSection } from "../../../components/ui/primitives/dashboard-heading";
import { Button, ButtonIcon } from "../../../components/ui/primitives/button";
import { ProviderIcon } from "../../../components/ui/primitives/provider-icon";
import {
  NavigationMenu,
  NavigationMenuItemIcon,
  NavigationMenuItemLabel,
} from "../../../components/ui/composites/navigation-menu/navigation-menu-items";
import {
  NavigationMenuEditableTemplateItem,
} from "../../../components/ui/composites/navigation-menu/navigation-menu-editable";
import { TemplateText } from "../../../components/ui/primitives/template-text";
import { ItemDisabledContext, MenuVariantContext } from "../../../components/ui/composites/navigation-menu/navigation-menu.contexts";
import {
  DISABLED_LABEL_TONE,
  LABEL_TONE,
  navigationMenuItemStyle,
  navigationMenuCheckbox,
  navigationMenuCheckboxIcon,
  navigationMenuToggleTrack,
  navigationMenuToggleThumb,
} from "../../../components/ui/composites/navigation-menu/navigation-menu.styles";
import {
  icalSourceInclusionAtom,
  selectSourceInclusion,
} from "../../../state/ical-sources";
import {
  feedSettingsAtom,
  feedSettingsLoadedAtom,
  feedSettingAtoms,
  customEventNameAtom,
  includeEventNameAtom,
} from "../../../state/ical-feed-settings";
import type { FeedSettingToggleKey } from "../../../state/ical-feed-settings";
import type { CalendarSource } from "../../../types/api";

type ICalTokenResponse = {
  token: string;
  icalUrl: string | null;
};

interface FeedSettings {
  includeEventName: boolean;
  includeEventDescription: boolean;
  includeEventLocation: boolean;
  excludeAllDayEvents: boolean;
  customEventName: string;
}

export const Route = createFileRoute("/(dashboard)/dashboard/ical")({
  component: ICalPage,
});

function ICalPage() {
  return (
    <div className="flex flex-col gap-1.5">
      <BackButton />
      <ICalLinkSection />
      <SourceSelectionSection />
      <FeedSettingsSeed />
      <DashboardSection
        title="Feed Settings"
        description={<>Choose which event details are included in your iCal feed. Use <Text as="span" size="sm" className="text-template inline">{"{{calendar_name}}"}</Text> or <Text as="span" size="sm" className="text-template inline">{"{{event_name}}"}</Text> in text fields for dynamic values.</>}
      />
      <FeedSettingsToggles />
    </div>
  );
}

function ICalLinkSection() {
  const { data } = useSWR<ICalTokenResponse>("/api/ical/token", fetcher);

  return (
    <div className="flex flex-col gap-2">
      <DashboardSection
        title="iCal Link"
        description="Subscribe to this link in any calendar app to see your aggregated events."
      />
      <div className="flex gap-1.5">
        <Input
          readOnly
          value={data?.icalUrl ?? ""}
          placeholder="No iCal link available"
          className="text-sm"
        />
        <CopyButton value={data?.icalUrl ?? null} />
      </div>
    </div>
  );
}

const copiedAtom = atom(false);

function CopyButton({ value }: { value: string | null }) {
  const store = useStore();

  const handleCopy = async () => {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    store.set(copiedAtom, true);
    setTimeout(() => store.set(copiedAtom, false), 2000);
  };

  return (
    <Button
      variant="border"
      className="shrink-0 aspect-square"
      onClick={handleCopy}
      disabled={!value}
    >
      <ButtonIcon>
        <CopyIcon />
      </ButtonIcon>
    </Button>
  );
}

function CopyIcon() {
  const copied = useAtomValue(copiedAtom);
  return copied ? <CheckIcon size={16} /> : <Copy size={16} />;
}

function FeedSettingsSeed() {
  const { data: settings } = useSWR<FeedSettings>("/api/ical/settings", fetcher);
  const store = useStore();

  if (settings && !store.get(feedSettingsLoadedAtom)) {
    store.set(feedSettingsAtom, settings);
    store.set(feedSettingsLoadedAtom, true);
  }

  return null;
}

function FeedSettingsToggles() {
  const loaded = useAtomValue(feedSettingsLoadedAtom);
  if (!loaded) return null;

  return (
    <NavigationMenu>
      <EventNameTemplateItem />
      <EventNameToggle />
      <FeedSettingToggle field="includeEventDescription" label="Include Event Description" />
      <FeedSettingToggle field="includeEventLocation" label="Include Event Location" />
      <FeedSettingToggle field="excludeAllDayEvents" label="Exclude All Day Events" />
    </NavigationMenu>
  );
}

const TEMPLATE_VARIABLES = { event_name: "Event Name", calendar_name: "Calendar Name" };

function EventNameDisabledProvider({ children }: { children: React.ReactNode }) {
  const includeEventName = useAtomValue(includeEventNameAtom);
  return <ItemDisabledContext value={includeEventName}>{children}</ItemDisabledContext>;
}

function EventNameTemplateItem() {
  const store = useStore();
  const { mutate } = useSWRConfig();

  return (
    <EventNameDisabledProvider>
      <NavigationMenuEditableTemplateItem
        label="Event Name"
        value={store.get(feedSettingsAtom).customEventName || "{{event_name}}"}
        renderInput={(live) => (
          <TemplateText template={live} variables={TEMPLATE_VARIABLES} />
        )}
        onCommit={(customEventName) => {
          store.set(feedSettingsAtom, (prev) => ({ ...prev, customEventName }));
          mutate(
            "/api/ical/settings",
            async (current: FeedSettings | undefined) => {
              await apiFetch("/api/ical/settings", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ customEventName }),
              });
              return { ...current!, customEventName };
            },
            {
              optimisticData: (current: FeedSettings | undefined) => ({ ...current!, customEventName }),
              rollbackOnError: true,
              revalidate: false,
            },
          );
        }}
      >
        <EventNameTemplateValue />
      </NavigationMenuEditableTemplateItem>
    </EventNameDisabledProvider>
  );
}

function EventNameTemplateValue() {
  const customEventName = useAtomValue(customEventNameAtom);
  const includeEventName = useAtomValue(includeEventNameAtom);
  const variant = use(MenuVariantContext);
  const template = customEventName || "{{event_name}}";

  return (
    <Text
      size="sm"
      tone={(includeEventName ? DISABLED_LABEL_TONE : LABEL_TONE)[variant ?? "default"]}
      className="min-w-0 truncate flex-1 text-right"
    >
      <TemplateText
        template={template}
        variables={TEMPLATE_VARIABLES}
        disabled={includeEventName}
      />
    </Text>
  );
}

function EventNameToggle() {
  const store = useStore();
  const variant = use(MenuVariantContext);
  const { mutate } = useSWRConfig();

  const handleClick = () => {
    const current = store.get(feedSettingsAtom).includeEventName;
    const patch = current
      ? { includeEventName: false, customEventName: "Busy" }
      : { includeEventName: true, customEventName: "{{event_name}}" };

    store.set(feedSettingsAtom, (prev) => ({ ...prev, ...patch }));
    mutate(
      "/api/ical/settings",
      async (settings: FeedSettings | undefined) => {
        await apiFetch("/api/ical/settings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        return { ...settings!, ...patch };
      },
      {
        optimisticData: (settings: FeedSettings | undefined) => ({ ...settings!, ...patch }),
        rollbackOnError: true,
        revalidate: false,
      },
    );
  };

  return (
    <li>
      <button
        type="button"
        role="switch"
        onClick={handleClick}
        className={navigationMenuItemStyle({ variant })}
      >
        <NavigationMenuItemLabel>Include Event Name</NavigationMenuItemLabel>
        <ToggleIndicator atom={includeEventNameAtom} />
      </button>
    </li>
  );
}

function FeedSettingToggle({ field, label }: { field: FeedSettingToggleKey; label: string }) {
  const store = useStore();
  const variant = use(MenuVariantContext);
  const { mutate } = useSWRConfig();

  const handleClick = () => {
    const current = store.get(feedSettingsAtom)[field];
    const newValue = !current;
    store.set(feedSettingsAtom, (prev) => ({ ...prev, [field]: newValue }));
    mutate(
      "/api/ical/settings",
      async (settings: FeedSettings | undefined) => {
        await apiFetch("/api/ical/settings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [field]: newValue }),
        });
        return { ...settings!, [field]: newValue };
      },
      {
        optimisticData: (settings: FeedSettings | undefined) => ({ ...settings!, [field]: newValue }),
        rollbackOnError: true,
        revalidate: false,
      },
    );
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
        <ToggleIndicator atom={feedSettingAtoms[field]} />
      </button>
    </li>
  );
}

function ToggleIndicator({ atom }: { atom: Parameters<typeof useAtomValue>[0] }) {
  const checked = useAtomValue(atom) as boolean;
  const variant = use(MenuVariantContext);

  return (
    <div className={navigationMenuToggleTrack({ variant, checked, className: "ml-auto" })}>
      <div className={navigationMenuToggleThumb({ variant, checked })} />
    </div>
  );
}

function SourceSelectionSection() {
  const { data: sources } = useSWR<CalendarSource[]>("/api/sources", fetcher);
  const store = useStore();

  if (sources && Object.keys(store.get(icalSourceInclusionAtom)).length === 0) {
    const map: Record<string, boolean> = {};
    for (const source of sources) {
      map[source.id] = source.includeInIcalFeed;
    }
    store.set(icalSourceInclusionAtom, map);
  }

  const pullSources = useMemo(
    () => sources?.filter((source) => source.capabilities.includes("pull")),
    [sources],
  );

  if (!pullSources || pullSources.length === 0) {
    return (
      <DashboardSection
        title="Sources"
        description={sources ? "No calendar sources to include. Import calendars first." : "Loading sources..."}
      />
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <DashboardSection
        title="Sources"
        description="Select which calendars contribute events to your iCal feed."
      />
      <NavigationMenu>
        {pullSources.map((source) => (
          <SourceCheckboxItem
            key={source.id}
            sourceId={source.id}
            name={source.name}
            provider={source.provider}
            calendarType={source.calendarType}
          />
        ))}
      </NavigationMenu>
    </div>
  );
}

function SourceCheckboxItem({
  sourceId,
  name,
  provider,
  calendarType,
}: {
  sourceId: string;
  name: string;
  provider: string;
  calendarType: string;
}) {
  const store = useStore();
  const variant = use(MenuVariantContext);

  const handleClick = () => {
    const current = store.get(icalSourceInclusionAtom)[sourceId] ?? false;
    store.set(icalSourceInclusionAtom, (prev) => ({ ...prev, [sourceId]: !current }));
    apiFetch(`/api/sources/${sourceId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ includeInIcalFeed: !current }),
    });
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
        <CheckboxIndicator sourceId={sourceId} />
      </button>
    </li>
  );
}

function CheckboxIndicator({ sourceId }: { sourceId: string }) {
  const checkedAtom = useMemo(() => selectSourceInclusion(sourceId), [sourceId]);
  const checked = useAtomValue(checkedAtom);
  const variant = use(MenuVariantContext);

  return (
    <div className={navigationMenuCheckbox({ variant, checked, className: "ml-auto" })}>
      {checked && <CheckIcon size={12} className={navigationMenuCheckboxIcon({ variant })} />}
    </div>
  );
}
