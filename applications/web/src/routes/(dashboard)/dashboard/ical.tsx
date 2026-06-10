import { use, useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import useSWR from "swr";
import { atom, useAtomValue, useStore } from "jotai";
import Copy from "lucide-react/dist/esm/icons/copy";
import CheckIcon from "lucide-react/dist/esm/icons/check";
import { fetcher, apiFetch } from "@/lib/fetcher";
import { track, ANALYTICS_EVENTS } from "@/lib/analytics";
import { serializedPatch } from "@/lib/serialized-mutate";
import { BackButton } from "@/components/ui/primitives/back-button";
import { Input } from "@/components/ui/primitives/input";
import { Text } from "@/components/ui/primitives/text";
import { PremiumFeatureGate } from "@/components/ui/primitives/upgrade-hint";
import { DashboardSection } from "@/components/ui/primitives/dashboard-heading";
import { Button, ButtonIcon } from "@/components/ui/primitives/button";
import { ProviderIcon } from "@/components/ui/primitives/provider-icon";
import {
  NavigationMenu,
  NavigationMenuCheckboxItem,
  NavigationMenuItemIcon,
  NavigationMenuItemLabel,
  NavigationMenuToggleItem,
} from "@/components/ui/composites/navigation-menu/navigation-menu-items";
import {
  NavigationMenuEditableTemplateItem,
} from "@/components/ui/composites/navigation-menu/navigation-menu-editable";
import { TemplateText } from "@/components/ui/primitives/template-text";
import { ItemDisabledContext, MenuVariantContext } from "@/components/ui/composites/navigation-menu/navigation-menu.contexts";
import {
  DISABLED_LABEL_TONE,
  LABEL_TONE,
} from "@/components/ui/composites/navigation-menu/navigation-menu.styles";
import {
  icalSourceInclusionAtom,
  selectSourceInclusion,
} from "@/state/ical-sources";
import {
  feedSettingsAtom,
  feedSettingsLoadedAtom,
  feedSettingAtoms,
  customEventNameAtom,
  includeEventNameAtom,
} from "@/state/ical-feed-settings";
import type { FeedSettingToggleKey } from "@/state/ical-feed-settings";
import type { CalendarSource } from "@/types/api";
import { useEntitlements } from "@/hooks/use-entitlements";

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

function patchFeedSettings(
  store: ReturnType<typeof useStore>,
  patch: Record<string, unknown>,
) {
  const swrKey = "/api/ical/settings";
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
      fetcher<FeedSettings>(swrKey).then((serverState) => {
        store.set(feedSettingsAtom, serverState);
      });
    },
  );
}

function ICalPage() {
  const { data: entitlements } = useEntitlements();
  const locked = entitlements ? !entitlements.canCustomizeIcalFeed : false;

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
      <FeedSettingsToggles locked={locked} />
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
    track(ANALYTICS_EVENTS.ical_link_copied);
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

function FeedSettingsToggles({ locked }: { locked: boolean }) {
  const loaded = useAtomValue(feedSettingsLoadedAtom);
  if (!loaded) return null;

  return (
    <PremiumFeatureGate
      locked={locked}
      hint="Feed settings are Pro-only."
    >
      <NavigationMenu>
        <EventNameTemplateItem locked={locked} />
        <EventNameToggle locked={locked} />
        <FeedSettingToggle locked={locked} field="includeEventDescription" label="Include Event Description" />
        <FeedSettingToggle locked={locked} field="includeEventLocation" label="Include Event Location" />
        <FeedSettingToggle locked={locked} field="excludeAllDayEvents" label="Exclude All Day Events" />
      </NavigationMenu>
    </PremiumFeatureGate>
  );
}

const TEMPLATE_VARIABLES = { event_name: "Event Name", calendar_name: "Calendar Name" };

function EventNameDisabledProvider({ locked, children }: { locked: boolean; children: React.ReactNode }) {
  const includeEventName = useAtomValue(includeEventNameAtom);
  return <ItemDisabledContext value={locked || includeEventName}>{children}</ItemDisabledContext>;
}

function EventNameTemplateItem({ locked }: { locked: boolean }) {
  const store = useStore();
  const eventName = useAtomValue(customEventNameAtom);

  return (
    <EventNameDisabledProvider locked={locked}>
      <NavigationMenuEditableTemplateItem
        label="Event Name"
        disabled={locked}
        value={eventName || "{{event_name}}"}
        renderInput={(live) => (
          <TemplateText template={live} variables={TEMPLATE_VARIABLES} />
        )}
        onCommit={(customEventName) => {
          store.set(feedSettingsAtom, (prev) => ({ ...prev, customEventName }));
          patchFeedSettings(store, { customEventName });
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
  const disabled = use(ItemDisabledContext);
  const variant = use(MenuVariantContext);
  const template = customEventName || "{{event_name}}";

  return (
    <Text
      size="sm"
      tone={((disabled || includeEventName) ? DISABLED_LABEL_TONE : LABEL_TONE)[variant ?? "default"]}
      className="min-w-0 truncate flex-1 text-right"
    >
      <TemplateText
        template={template}
        variables={TEMPLATE_VARIABLES}
        disabled={disabled || includeEventName}
      />
    </Text>
  );
}

function EventNameToggle({ locked }: { locked: boolean }) {
  const store = useStore();
  const checked = useAtomValue(includeEventNameAtom);

  const handleClick = () => {
    if (locked) return;

    const currentlyIncluded = store.get(feedSettingsAtom).includeEventName;

    if (currentlyIncluded) {
      const patch = { includeEventName: false, customEventName: "Busy" };
      track(ANALYTICS_EVENTS.ical_setting_toggled, { field: "includeEventName", enabled: false });
      store.set(feedSettingsAtom, (prev) => ({ ...prev, ...patch }));
      patchFeedSettings(store, patch);
    } else {
      const patch = { includeEventName: true, customEventName: "{{event_name}}" };
      track(ANALYTICS_EVENTS.ical_setting_toggled, { field: "includeEventName", enabled: true });
      store.set(feedSettingsAtom, (prev) => ({ ...prev, ...patch }));
      patchFeedSettings(store, patch);
    }
  };

  return (
    <NavigationMenuToggleItem
      checked={checked}
      disabled={locked}
      onCheckedChange={() => handleClick()}
    >
      <NavigationMenuItemLabel>Include Event Name</NavigationMenuItemLabel>
    </NavigationMenuToggleItem>
  );
}

function FeedSettingToggle({
  field,
  label,
  locked,
}: {
  field: FeedSettingToggleKey;
  label: string;
  locked: boolean;
}) {
  const store = useStore();
  const checked = useAtomValue(feedSettingAtoms[field]);

  const handleClick = () => {
    if (locked) return;

    const current = store.get(feedSettingsAtom)[field];
    const newValue = !current;
    track(ANALYTICS_EVENTS.ical_setting_toggled, { field, enabled: newValue });
    store.set(feedSettingsAtom, (prev) => ({ ...prev, [field]: newValue }));
    patchFeedSettings(store, { [field]: newValue });
  };

  return (
    <NavigationMenuToggleItem
      checked={checked}
      disabled={locked}
      onCheckedChange={() => handleClick()}
    >
      <NavigationMenuItemLabel>{label}</NavigationMenuItemLabel>
    </NavigationMenuToggleItem>
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
  const checkedAtom = useMemo(() => selectSourceInclusion(sourceId), [sourceId]);
  const checked = useAtomValue(checkedAtom);

  const handleCheckedChange = (nextChecked: boolean) => {
    track(ANALYTICS_EVENTS.ical_source_toggled, { enabled: nextChecked });
    store.set(icalSourceInclusionAtom, (prev) => ({ ...prev, [sourceId]: nextChecked }));
    const sourceKey = `/api/sources/${sourceId}`;
    serializedPatch(sourceKey, { includeInIcalFeed: nextChecked }, (mergedPatch) => {
      return apiFetch(sourceKey, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mergedPatch),
      });
    });
  };

  return (
    <NavigationMenuCheckboxItem
      checked={checked}
      onCheckedChange={handleCheckedChange}
    >
      <NavigationMenuItemIcon>
        <ProviderIcon provider={provider} calendarType={calendarType} />
      </NavigationMenuItemIcon>
      <NavigationMenuItemLabel>{name}</NavigationMenuItemLabel>
    </NavigationMenuCheckboxItem>
  );
}
