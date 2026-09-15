import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore, Provider } from "jotai";
import type { CalendarAccount, CalendarDetail } from "../../../src/types/api";
import { destinationIdsAtom } from "../../../src/state/destination-ids";
import { makeSource } from "../../features/setup/fixtures";
import "../../../src/routes/(dashboard)/dashboard/accounts/$accountId.$calendarId";

const ACCOUNT_ID = "account-1";
const CALENDAR_ID = "calendar-1";

interface CapturedRoute {
  component: (() => React.ReactElement) | null;
}

const { captured, swrData } = vi.hoisted(() => ({
  captured: { component: null } as CapturedRoute,
  swrData: new Map<string, unknown>(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: { component: () => React.ReactElement }) => {
    captured.component = options.component;
    return { useParams: () => ({ accountId: ACCOUNT_ID, calendarId: CALENDAR_ID }) };
  },
  Link: ({ children, to, ...rest }: { children?: React.ReactNode; to?: string; "aria-label"?: string }) => (
    <a href={to} aria-label={rest["aria-label"]}>{children}</a>
  ),
  useCanGoBack: () => false,
  useNavigate: () => () => null,
  useRouter: () => ({ history: { back: () => null } }),
}));

vi.mock("swr", () => {
  const useSWR = (key: string) => ({
    data: swrData.get(key),
    error: undefined,
    isLoading: false,
    mutate: () => Promise.resolve(undefined),
  });
  return {
    default: useSWR,
    preload: () => Promise.resolve(undefined),
    useSWRConfig: () => ({ mutate: () => Promise.resolve(undefined) }),
  };
});

vi.mock("../../../src/hooks/use-entitlements", () => ({
  canAddMore: () => true,
  useEntitlements: () => ({ data: { canUseEventFilters: true } }),
  useMutateEntitlements: () => ({ adjustMappingCount: () => null, revalidateEntitlements: () => Promise.resolve(undefined) }),
}));

const account: CalendarAccount = {
  accountIdentifier: "account-identifier",
  accountLabel: "Work Account",
  authType: "oauth",
  calendarCount: 1,
  calendarsRefreshedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  displayName: "Work Account",
  email: null,
  id: ACCOUNT_ID,
  needsReauthentication: false,
  provider: "google",
  providerIcon: null,
  providerName: "Google",
};

const makeCalendar = (calendarType: string): CalendarDetail => ({
  calendarType,
  calendarUrl: null,
  capabilities: ["pull", "push"],
  createdAt: "2026-01-01T00:00:00.000Z",
  customEventName: "",
  destinationIds: ["personal"],
  disabled: false,
  excludeAllDayEvents: false,
  excludeEventDescription: false,
  excludeEventLocation: false,
  excludeEventName: false,
  excludeFocusTime: false,
  excludeOutOfOffice: false,
  id: CALENDAR_ID,
  ingestFailureCount: 0,
  ingestLastFailureAt: null,
  markEventsAsPrivate: false,
  name: "Work",
  originalName: "Work",
  provider: "google",
  providerIcon: null,
  providerMissingSince: null,
  providerName: "Google",
  sourceIds: [],
  syncFutureRange: "12_months",
  syncHistoricRange: "12_months",
  treatFullDayTimedEventsAsAllDay: false,
  unavailableSince: null,
  updatedAt: "2026-01-01T00:00:00.000Z",
  url: null,
});

const renderPage = (calendarType: string, checkedIds: string[]): string => {
  swrData.clear();
  swrData.set(`/api/accounts/${ACCOUNT_ID}`, account);
  swrData.set(`/api/sources/${CALENDAR_ID}`, makeCalendar(calendarType));
  swrData.set(`/api/sources/${CALENDAR_ID}/destinations`, { destinationIds: checkedIds });
  swrData.set("/api/sources", [
    makeSource("personal", "outlook-account", ["pull", "push"], { name: "Personal", provider: "outlook" }),
    makeSource("family", "outlook-account", ["pull", "push"], { name: "Family", provider: "outlook" }),
  ]);
  const store = createStore();
  store.set(destinationIdsAtom, new Set(checkedIds));
  const Page = captured.component;
  if (!Page) throw new Error("Calendar detail route did not register a component");
  return renderToStaticMarkup(<Provider store={store}><Page /></Provider>);
};

describe("calendar detail destinations", () => {
  it("links each selected destination to its pair's rules and drops the old switches", () => {
    const markup = renderPage("oauth", ["personal"]);

    expect(markup).toContain(`href="/dashboard/rules/pairs/${CALENDAR_ID}/personal"`);
    expect(markup).toContain('aria-label="Rules for Personal"');
    expect(markup).not.toContain('aria-label="Rules for Family"');
    expect(markup).toContain("Tap the rules icon on a selected calendar");
    expect(markup).not.toContain("Sync Settings");
    expect(markup).not.toContain("Exclusions");
    expect(markup).not.toContain("All-Day Events");
  });

  it("keeps the all-day treatment for ical calendars", () => {
    const markup = renderPage("ical", []);

    expect(markup).toContain("All-Day Events");
    expect(markup).toContain("Sync Full-Day Events as All-Day");
  });
});
