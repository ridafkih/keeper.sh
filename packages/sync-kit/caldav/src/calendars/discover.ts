import type {
  AccountId,
  CalendarEnumeration,
  CalendarRef,
  OperationContext,
  Result,
} from "@keeper.sh/sync-protocol";
import type { DAVCalendar } from "tsdav";
import type { DavCall } from "../client/dav-client";
import { beginOperation } from "../client/operation";
import { runCalDAVRequest } from "../client/request";
import type { FailureSurroundings } from "../errors/to-provider-failure";
import { caldavAccountId } from "../identity/account";
import { normalizeCollectionKey } from "../identity/collection-key";
import { normalizeResourcePath } from "../identity/resource-path";
import type { CalDAVInternals } from "../internals";
import { listed } from "../xml/listed";
import { calendarAccessOf } from "./access";

const eventComponent = "VEVENT";

interface DiscoveredHome {
  readonly principalUrl: string;
  readonly calendars: readonly DAVCalendar[];
}

const carriesEvents = (calendar: DAVCalendar): boolean =>
  (calendar.components ?? []).includes(eventComponent);

const displayNameOf = (calendar: DAVCalendar, path: string): string => {
  const { displayName } = calendar;
  if (typeof displayName === "string" && displayName.length > 0) {
    return displayName;
  }
  const segments = path.split("/").filter((segment) => segment.length > 0);
  return segments.at(-1) ?? path;
};

const branchNames = (branch: unknown): readonly string[] => {
  if (typeof branch !== "object" || branch === null) {
    return [];
  }
  return Object.keys(branch);
};

const privilegesOf = (calendar: DAVCalendar): readonly string[] => {
  const projected = calendar.projectedProps ?? {};
  const privileges = projected.currentUserPrivilegeSet;
  if (typeof privileges !== "object" || privileges === null) {
    return [];
  }
  return listed(Reflect.get(privileges, "privilege")).flatMap((entry) => branchNames(entry));
};

const calendarRefOf = (
  account: AccountId,
  calendar: DAVCalendar,
  base: string,
): CalendarRef => {
  const path = normalizeResourcePath(calendar.url, base);
  return {
    key: {
      provider: "caldav",
      account,
      calendar: normalizeCollectionKey(path, base),
    },
    displayName: displayNameOf(calendar, path),
    timeZone: null,
    access: calendarAccessOf(privilegesOf(calendar)),
  };
};

const discoverHome = async (
  internals: CalDAVInternals,
  call: DavCall,
): Promise<DiscoveredHome> => {
  const { credentials } = internals.dependencies;
  const account = await call.client.createAccount({
    account: { serverUrl: credentials.serverUrl, accountType: "caldav" },
    loadCollections: false,
    loadObjects: false,
    fetchOptions: { signal: call.signal },
    fetch: call.transport,
  });
  const calendars = await call.client.fetchCalendars({
    account,
    projectedProps: { currentUserPrivilegeSet: true },
    fetchOptions: { signal: call.signal },
    fetch: call.transport,
  });
  return { principalUrl: account.principalUrl ?? "", calendars };
};

const discoveredAccount = (
  requested: AccountId,
  principalUrl: string,
  serverUrl: string,
): AccountId => {
  if (principalUrl.length === 0) {
    return requested;
  }
  return caldavAccountId(serverUrl, principalUrl);
};

const discoverCalendars = async (
  internals: CalDAVInternals,
  account: AccountId,
  context: OperationContext,
): Promise<Result<CalendarEnumeration>> => {
  const base = internals.dependencies.credentials.serverUrl;
  const surroundings: FailureSurroundings = {
    account,
    calendar: { provider: "caldav", account, calendar: { kind: "calendarId", value: "/" } },
    scope: null,
    operation: "listCalendars",
  };
  const answered = await runCalDAVRequest<DiscoveredHome>(internals, {
    operation: "listCalendars",
    collections: ["/"],
    run: beginOperation(context, surroundings),
    accepts: [],
    call: (call: DavCall) => discoverHome(internals, call),
    statusOf: () => ({ status: 200, precondition: null, retryAfter: null }),
  });
  if (answered.kind === "failed") {
    return { ok: false, failure: answered.failure };
  }
  const owner = discoveredAccount(account, answered.value.principalUrl, base);
  const calendars = answered.value.calendars
    .filter((calendar) => carriesEvents(calendar))
    .map((calendar) => calendarRefOf(owner, calendar, base));
  return { ok: true, value: { kind: "snapshot", account: owner, calendars } };
};

export { discoverCalendars };
