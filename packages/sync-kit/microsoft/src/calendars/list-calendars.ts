import type {
  AccountId,
  CalendarAccess,
  CalendarEnumeration,
  CalendarKey,
  CalendarRef,
  OperationContext,
  Result,
  ZoneId,
} from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";
import { graphJson } from "../client/graph-call";
import { preferHeaders } from "../client/prefer";
import type { RequestSeam } from "../client/request";
import type { MicrosoftDependencies } from "../dependencies";
import { toProviderFailure } from "../errors/to-provider-failure";
import { resolvesAsZone } from "../write/normalize";

interface CalendarSurroundings {
  readonly dependencies: MicrosoftDependencies;
  readonly requests: RequestSeam;
}

const readProperty = (value: unknown, name: string): unknown => {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  return Reflect.get(value, name);
};

const textAt = (value: unknown, name: string): string | null => {
  const held = readProperty(value, name);
  if (typeof held !== "string" || held.length === 0) {
    return null;
  }
  return held;
};

const accessOf = (entry: unknown): CalendarAccess => {
  if (readProperty(entry, "canEdit") === true) {
    return "readWrite";
  }
  return "readOnly";
};

const zoneOf = (entry: unknown): ZoneId | null => {
  const zone = textAt(entry, "timeZone");
  if (zone === null || !resolvesAsZone(zone)) {
    return null;
  }
  return { kind: "zoneId", value: zone };
};

const keyOf = (account: AccountId, calendar: string): CalendarKey => ({
  provider: "microsoft",
  account,
  calendar: { kind: "calendarId", value: calendar },
});

const refOf = (entry: unknown, account: AccountId): CalendarRef | null => {
  const calendar = textAt(entry, "id");
  if (calendar === null) {
    return null;
  }
  return {
    key: keyOf(account, calendar),
    displayName: textAt(entry, "name") ?? calendar,
    timeZone: zoneOf(entry),
    access: accessOf(entry),
  };
};

const refsOf = (entries: readonly unknown[], account: AccountId): readonly CalendarRef[] =>
  entries.flatMap((entry) => {
    const ref = refOf(entry, account);
    if (ref === null) {
      return [];
    }
    return [ref];
  });

const enumeratedEntries = (body: unknown): readonly unknown[] | null => {
  const held = readProperty(body, "value");
  if (!Array.isArray(held)) {
    return null;
  }
  return held;
};

const listMicrosoftCalendars = async (
  account: AccountId,
  context: OperationContext,
  surroundings: CalendarSurroundings,
): Promise<Result<CalendarEnumeration>> => {
  const answered = await surroundings.requests.send<unknown>({
    operation: "listCalendars",
    mailboxes: [account.value],
    context,
    send: (signal) =>
      graphJson(
        surroundings.dependencies.graph,
        { method: "get", path: `users/${account.value}/calendars`, headers: preferHeaders() },
        signal,
      ),
  });
  switch (answered.kind) {
    case "notAttempted": {
      return { ok: false, failure: { kind: "notAttempted", reason: answered.reason } };
    }
    case "failed": {
      return {
        ok: false,
        failure: toProviderFailure(answered.failure, {
          operation: "listCalendars",
          account,
          calendar: null,
          scope: null,
        }),
      };
    }
    case "answered": {
      const entries = enumeratedEntries(answered.value);
      if (entries === null) {
        return {
          ok: false,
          failure: { kind: "transport", status: null, disposition: "permanent" },
        };
      }
      return {
        ok: true,
        value: { kind: "snapshot", account, calendars: refsOf(entries, account) },
      };
    }
    default: {
      return assertNever(answered);
    }
  }
};

export { listMicrosoftCalendars };
export type { CalendarSurroundings };
