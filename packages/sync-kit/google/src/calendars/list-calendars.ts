import type { calendar_v3 } from "@googleapis/calendar";
import type {
  AccountId,
  CalendarAccess,
  CalendarEnumeration,
  CalendarKey,
  CalendarRef,
  OperationContext,
  Result,
} from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";
import type { RequestSeam } from "../client/request";
import { decodeZoneId } from "../decode/event-time";
import { toProviderFailure } from "../errors/to-provider-failure";
import type { FailureSurroundings } from "../errors/to-provider-failure";
import type { GoogleDependencies } from "../dependencies";
import { googleListingLimits } from "../limits";

interface EnumerationSurroundings {
  readonly dependencies: GoogleDependencies;
  readonly requests: RequestSeam;
}

const writableRoles = new Set(["owner", "writer"]);

const accessOf = (entry: calendar_v3.Schema$CalendarListEntry): CalendarAccess => {
  if (typeof entry.accessRole === "string" && writableRoles.has(entry.accessRole)) {
    return "readWrite";
  }
  return "readOnly";
};

const keyOf = (account: AccountId, calendarId: string): CalendarKey => ({
  provider: "google",
  account,
  calendar: { kind: "calendarId", value: calendarId },
});

const refOf = (
  entry: calendar_v3.Schema$CalendarListEntry,
  account: AccountId,
): CalendarRef | null => {
  const calendarId = entry.id;
  if (typeof calendarId !== "string" || calendarId.length === 0) {
    return null;
  }
  return {
    key: keyOf(account, calendarId),
    displayName: entry.summary ?? calendarId,
    timeZone: decodeZoneId(entry.timeZone),
    access: accessOf(entry),
  };
};

const refsOn = (
  page: calendar_v3.Schema$CalendarList,
  account: AccountId,
): readonly CalendarRef[] =>
  (page.items ?? []).flatMap((entry) => {
    const ref = refOf(entry, account);
    if (ref === null) {
      return [];
    }
    return [ref];
  });

const nextTokenOf = (page: calendar_v3.Schema$CalendarList): string | null => {
  const token = page.nextPageToken;
  if (typeof token !== "string" || token.length === 0) {
    return null;
  }
  return token;
};

const listParameters = (pageToken: string | null): calendar_v3.Params$Resource$Calendarlist$List => {
  if (pageToken === null) {
    return {};
  }
  return { pageToken };
};

const enumerationFailure = (account: AccountId): FailureSurroundings => ({
  operation: "listCalendars",
  calendar: null,
  account,
  scope: null,
});

const listGoogleCalendars = async (
  account: AccountId,
  context: OperationContext,
  surroundings: EnumerationSurroundings,
): Promise<Result<CalendarEnumeration>> => {
  const fetchPage = (token: string | null) =>
    surroundings.requests.send("listCalendars", context, (signal) =>
      surroundings.dependencies.calendar.calendarList.list(listParameters(token), { signal }),
    );
  const collected: CalendarRef[] = [];
  const walk: { pageToken: string | null } = { pageToken: null };
  for (const _page of Array.from({ length: googleListingLimits.maxPages })) {
    const answered = await fetchPage(walk.pageToken);
    switch (answered.kind) {
      case "notAttempted": {
        return { ok: false, failure: { kind: "notAttempted", reason: answered.reason } };
      }
      case "failed": {
        return {
          ok: false,
          failure: toProviderFailure(answered.failure, enumerationFailure(account)),
        };
      }
      case "answered": {
        collected.push(...refsOn(answered.value.data, account));
        walk.pageToken = nextTokenOf(answered.value.data);
        break;
      }
      default: {
        return assertNever(answered);
      }
    }
    if (walk.pageToken === null) {
      return { ok: true, value: { kind: "snapshot", account, calendars: collected } };
    }
  }
  return { ok: false, failure: { kind: "notAttempted", reason: "budgetExhausted" } };
};

export { listGoogleCalendars };
export type { EnumerationSurroundings };
