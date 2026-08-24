import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { CalendarAccount, CalendarDetail } from "../../../src/types/api";
import "../../../src/routes/(dashboard)/dashboard/accounts/$accountId.$calendarId";

const ACCOUNT_ID = "account-1";
const CALENDAR_ID = "calendar-1";

interface CapturedRoute {
  component: (() => React.ReactElement) | null;
}

const { captured, swrData } = vi.hoisted(() => {
  const capturedRoute: CapturedRoute = { component: null };
  return { captured: capturedRoute, swrData: new Map<string, unknown>() };
});

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: { component: () => React.ReactElement }) => {
    captured.component = options.component;
    return { useParams: () => ({ accountId: ACCOUNT_ID, calendarId: CALENDAR_ID }) };
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
  useMutateEntitlements: () => () => Promise.resolve(undefined),
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
  provider: "outlook",
  providerIcon: null,
  providerName: "Outlook",
};

const makeCalendar = (capabilities: string[]): CalendarDetail => ({
  calendarType: "oauth",
  calendarUrl: null,
  capabilities,
  createdAt: "2026-01-01T00:00:00.000Z",
  customEventName: "",
  destinationIds: [],
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
  name: "Team Calendar",
  originalName: "Team Calendar",
  provider: "outlook",
  providerIcon: null,
  providerMissingSince: null,
  providerName: "Outlook",
  sourceIds: [],
  syncFutureRange: "12_months",
  syncHistoricRange: "12_months",
  treatFullDayTimedEventsAsAllDay: false,
  unavailableSince: null,
  updatedAt: "2026-01-01T00:00:00.000Z",
  url: null,
});

const renderPage = (capabilities: string[]): string => {
  swrData.clear();
  swrData.set(`/api/accounts/${ACCOUNT_ID}`, account);
  swrData.set(`/api/sources/${CALENDAR_ID}`, makeCalendar(capabilities));
  swrData.set("/api/sources", []);

  const Page = captured.component;
  if (!Page) throw new Error("Calendar detail route did not register a component");
  return renderToStaticMarkup(<Page />);
};

describe("calendar detail page delete affordance", () => {
  it("offers removal for a calendar keeper only pulls from", () => {
    const markup = renderPage(["pull"]);

    expect(markup).toContain("Delete Calendar");
  });

  it("hides removal for a calendar keeper pushes events to", () => {
    const markup = renderPage(["pull", "push"]);

    expect(markup.includes("Delete Calendar")).toBe(false);
    expect(markup.includes("Remove Calendar")).toBe(false);
  });
});
