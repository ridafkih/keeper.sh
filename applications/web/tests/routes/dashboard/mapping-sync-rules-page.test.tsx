import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NO_SYNC_RULE_OVERRIDES, resolveSyncRules } from "@keeper.sh/data-schemas";
import type {
  CalendarDetail,
  CalendarSource,
  InheritedSource,
  MappingSyncRules,
} from "../../../src/types/api";
import type { RuleOverrides, Rules } from "../../../src/utils/mapping-sync-rules";
import { HttpError } from "../../../src/lib/fetcher";
import "../../../src/routes/(dashboard)/dashboard/accounts/$accountId.$calendarId_.destinations.$destinationId";

const ACCOUNT_ID = "account-1";
const SOURCE_ID = "source-1";
const DESTINATION_ID = "destination-1";
const SOURCE_KEY = `/api/sources/${SOURCE_ID}`;
const MAPPING_KEY = `/api/sources/${SOURCE_ID}/destinations/${DESTINATION_ID}`;
const DESTINATION_SOURCES_KEY = `/api/sources/${DESTINATION_ID}/sources`;
const UPSTREAM_ID = "upstream-1";

interface CapturedRoute {
  component: (() => React.ReactElement) | null;
}

const { captured, swrData, swrErrors, entitlements } = vi.hoisted(() => {
  const capturedRoute: CapturedRoute = { component: null };
  return {
    captured: capturedRoute,
    entitlements: { canUseEventFilters: true },
    swrData: new Map<string, unknown>(),
    swrErrors: new Map<string, unknown>(),
  };
});

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: { component: () => React.ReactElement }) => {
    captured.component = options.component;
    return {
      useParams: () => ({
        accountId: ACCOUNT_ID,
        calendarId: SOURCE_ID,
        destinationId: DESTINATION_ID,
      }),
    };
  },
  Link: ({ children, to }: { children?: React.ReactNode; to?: string }) => (
    <a href={to}>{children}</a>
  ),
  useCanGoBack: () => false,
  useNavigate: () => () => null,
  useRouter: () => ({ history: { back: () => null } }),
}));

vi.mock("swr", () => {
  const useSWR = (key: string) => ({
    data: swrData.get(key),
    error: swrErrors.get(key),
    isLoading: false,
    mutate: () => Promise.resolve(undefined),
  });
  return {
    default: useSWR,
    useSWRConfig: () => ({ mutate: () => Promise.resolve(undefined) }),
  };
});

vi.mock("../../../src/hooks/use-entitlements", () => ({
  useEntitlements: () => ({ data: entitlements }),
  useMutateEntitlements: () => ({
    adjustMappingCount: () => null,
    revalidateEntitlements: () => Promise.resolve(),
  }),
}));

vi.mock("../../../src/config/commercial", () => ({
  getCommercialMode: () => true,
}));

const SOURCE_RULES: Rules = {
  customEventName: "{{calendar_name}}",
  disableEventReminders: false,
  excludeAllDayEvents: false,
  excludeAvailabilities: [],
  excludeEventDescription: true,
  excludeEventLocation: true,
  excludeEventMeetingLink: false,
  excludeEventName: true,
  excludeFocusTime: false,
  excludeOutOfOffice: false,
  excludeTitleKeywords: ["lunch"],
  markEventsAsPrivate: false,
};

const makeSource = (provider: string): CalendarDetail => ({
  ...SOURCE_RULES,
  calendarType: "oauth",
  calendarUrl: null,
  capabilities: ["pull"],
  createdAt: "2026-01-01T00:00:00.000Z",
  destinationIds: [DESTINATION_ID],
  disabled: false,
  id: SOURCE_ID,
  ingestFailureCount: 0,
  ingestLastFailureAt: null,
  name: "Personal",
  originalName: "Personal",
  provider,
  providerIcon: null,
  providerMissingSince: null,
  providerName: provider,
  sourceIds: [],
  syncFutureRange: "12_months",
  syncHistoricRange: "12_months",
  treatFullDayTimedEventsAsAllDay: false,
  unavailableSince: null,
  updatedAt: "2026-01-01T00:00:00.000Z",
  url: null,
});

const makeDestination = (): CalendarSource => ({
  accountId: ACCOUNT_ID,
  accountIdentifier: null,
  accountLabel: "Work Account",
  calendarType: "oauth",
  capabilities: ["pull", "push"],
  disabled: false,
  displayName: null,
  email: null,
  excludeEventName: true,
  id: DESTINATION_ID,
  includeInIcalFeed: false,
  name: "Family",
  needsReauthentication: false,
  provider: "google",
  providerIcon: null,
  providerMissingSince: null,
  providerName: "Google",
  unavailableSince: null,
});

const makeMapping = (overrides: Partial<RuleOverrides> = {}): MappingSyncRules => {
  const merged = { ...NO_SYNC_RULE_OVERRIDES, ...overrides };
  return {
    destinationCalendarId: DESTINATION_ID,
    effectiveRules: resolveSyncRules(SOURCE_RULES, merged),
    includeUpstreamSources: false,
    overrides: merged,
    sourceCalendarId: SOURCE_ID,
    sourceRules: SOURCE_RULES,
  };
};

interface PageState {
  includeUpstreamSources?: boolean;
  inheritedSources?: InheritedSource[];
  overrides?: Partial<RuleOverrides>;
  provider?: string;
  destinations?: CalendarSource[];
}

const seedPage = ({
  includeUpstreamSources = false,
  inheritedSources = [],
  overrides,
  provider = "google",
  destinations,
}: PageState = {}): void => {
  swrData.set(SOURCE_KEY, makeSource(provider));
  swrData.set("/api/sources", destinations ?? [makeDestination()]);
  swrData.set(MAPPING_KEY, { ...makeMapping(overrides), includeUpstreamSources });
  swrData.set(DESTINATION_SOURCES_KEY, { inheritedSources, sourceIds: [SOURCE_ID] });
};

const render = (): string => {
  const Page = captured.component;
  if (!Page) throw new Error("Mapping sync rules route did not register a component");
  return renderToStaticMarkup(<Page />);
};

const renderPage = (state: PageState = {}): string => {
  seedPage(state);
  return render();
};

const rowText = (markup: string, label: string): string => {
  const start = markup.indexOf(label);
  if (start === -1) throw new Error(`Row "${label}" was not rendered`);
  return markup.slice(start, markup.indexOf("</button>", start)).replace(/<[^>]+>/g, " ");
};

describe("per-destination sync rules page", () => {
  beforeEach(() => {
    swrData.clear();
    swrErrors.clear();
    entitlements.canUseEventFilters = true;
  });

  it("offers inherited events switched off until the link opts in", () => {
    const markup = renderPage();

    expect(markup).toContain("Keeper.sh syncs into Personal");
    expect(rowText(markup, "Include Inherited Events")).not.toContain("via");
    expect(markup).toMatch(/role="switch" aria-checked="false"[^>]*>.*Include Inherited Events/s);
  });

  it("lists each inherited calendar by the calendar it comes through", () => {
    const markup = renderPage({
      destinations: [
        makeDestination(),
        { ...makeDestination(), id: SOURCE_ID, name: "Personal" },
        { ...makeDestination(), id: UPSTREAM_ID, name: "Aubrey" },
      ],
      includeUpstreamSources: true,
      inheritedSources: [{ sourceCalendarId: UPSTREAM_ID, viaCalendarIds: [SOURCE_ID] }],
    });

    expect(markup).toMatch(/role="switch" aria-checked="true"[^>]*>.*Include Inherited Events/s);
    expect(markup).toContain("Aubrey");
    expect(markup).toContain("via Personal");
  });

  it("hides inherited calendars that reach the destination through another link", () => {
    const markup = renderPage({
      destinations: [
        makeDestination(),
        { ...makeDestination(), id: UPSTREAM_ID, name: "Aubrey" },
      ],
      includeUpstreamSources: true,
      inheritedSources: [{ sourceCalendarId: UPSTREAM_ID, viaCalendarIds: ["another-link"] }],
    });

    expect(markup).not.toContain("Aubrey");
  });

  it("names both calendars so the direction of the sync is unambiguous", () => {
    const markup = renderPage();

    expect(markup).toContain("Family");
    expect(markup).toContain("Receiving events from Personal");
  });

  it("shows every rule as following the calendar default when nothing is overridden", () => {
    const markup = renderPage();

    expect(rowText(markup, "Event Name")).toContain("Default (Replaced)");
    expect(rowText(markup, "Sync Event Description")).toContain("Default (Off)");
    expect(rowText(markup, "Sync Event Location")).toContain("Default (Off)");
    expect(rowText(markup, "Mark Events as Private")).toContain("Default (Off)");
    expect(rowText(markup, "Disable Reminders")).toContain("Default (Off)");
    expect(rowText(markup, "Exclude All Day Events")).toContain("Default (Off)");
    expect(rowText(markup, "Exclude by Status")).toContain("Default (None)");
    expect(rowText(markup, "Exclude Titles Containing")).toContain("Default (lunch)");
  });

  it("shows an overridden rule by its own value rather than the default", () => {
    const markup = renderPage({
      overrides: { excludeEventDescription: false, excludeEventName: false },
    });

    expect(rowText(markup, "Event Name")).toContain("Shown");
    expect(rowText(markup, "Event Name")).not.toContain("Default");
    expect(rowText(markup, "Sync Event Description")).toContain("On");
    expect(rowText(markup, "Sync Event Location")).toContain("Default (Off)");
  });

  it("offers the replacement text only while event names are replaced", () => {
    expect(renderPage()).toContain("Replace Name With");
    expect(renderPage({ overrides: { excludeEventName: false } }))
      .not.toContain("Replace Name With");
  });

  it("offers the keyword editor only for a custom keyword list", () => {
    expect(renderPage()).not.toContain("Keywords</");

    const markup = renderPage({ overrides: { excludeTitleKeywords: ["gym", "school run"] } });

    expect(rowText(markup, "Exclude Titles Containing")).toContain("Custom");
    expect(markup).toContain("gym, school run");
  });

  it("offers focus time and out of office exclusions only for a Google source", () => {
    expect(renderPage({ provider: "google" })).toContain("Exclude Focus Time Events");

    const outlook = renderPage({ provider: "outlook" });

    expect(outlook).not.toContain("Exclude Focus Time Events");
    expect(outlook).not.toContain("Exclude Out of Office Events");
    expect(outlook).toContain("Exclude All Day Events");
  });

  it("disables the reset action until something is customized", () => {
    expect(rowText(renderPage(), "Reset to Calendar Defaults")).toBeTruthy();
    expect(renderPage()).toMatch(/<button[^>]*disabled=""[^>]*>(?:(?!<\/button>).)*Reset to Calendar Defaults/s);
    expect(renderPage({ overrides: { markEventsAsPrivate: true } }))
      .not.toMatch(/<button[^>]*disabled=""[^>]*>(?:(?!<\/button>).)*Reset to Calendar Defaults/s);
  });

  it("locks the rules behind the Pro gate but leaves reset available on the free plan", () => {
    entitlements.canUseEventFilters = false;

    const markup = renderPage({ overrides: { excludeEventName: false } });

    expect(markup).toContain("Per-calendar sync settings are a Pro feature.");
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>(?:(?!<\/button>).)*Sync Event Description/s);
    expect(markup)
      .not.toMatch(/<button[^>]*disabled=""[^>]*>(?:(?!<\/button>).)*Reset to Calendar Defaults/s);
  });

  it("explains that the calendars are not syncing when the mapping does not exist", () => {
    seedPage();
    swrData.delete(MAPPING_KEY);
    swrErrors.set(MAPPING_KEY, new HttpError(404, MAPPING_KEY));

    const markup = render();

    expect(markup).toContain("not syncing with each other");
    expect(markup).not.toContain("Sync Settings");
  });

  it("explains that the calendars are not syncing when the destination is gone", () => {
    const markup = renderPage({ destinations: [] });

    expect(markup).toContain("not syncing with each other");
  });

  it("shows the retry state for a failure that is not a missing mapping", () => {
    seedPage();
    swrData.delete(MAPPING_KEY);
    swrErrors.set(MAPPING_KEY, new HttpError(500, MAPPING_KEY));

    const markup = render();

    expect(markup).not.toContain("not syncing with each other");
    expect(markup).not.toContain("Sync Settings");
  });

  it("renders nothing interactive until the mapping has loaded", () => {
    seedPage();
    swrData.delete(MAPPING_KEY);

    expect(render()).not.toContain("Sync Settings");
  });
});
