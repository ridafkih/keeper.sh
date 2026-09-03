import type { CalendarKey, EventTime, RemoteEvent } from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";
import type { SourceIdentity } from "../../src/index";

const nul = String.fromCodePoint(0);

const expectedCalendarKeyString = (key: CalendarKey): string =>
  [key.provider, key.account.value, key.calendar.value].join(nul);

const expectedSourceIdentityKey = (identity: SourceIdentity): string => {
  switch (identity.kind) {
    case "master": {
      return ["master", identity.uid.value].join(nul);
    }
    case "override": {
      return ["override", identity.uid.value, identity.recurrenceInstant.value].join(nul);
    }
    case "slot": {
      return ["slot", identity.uid.value, identity.start.value, identity.end.value].join(nul);
    }
    default: {
      return assertNever(identity);
    }
  }
};

const boundsOf = (time: EventTime): { readonly start: string; readonly end: string } => {
  switch (time.kind) {
    case "timed": {
      return { start: time.start.value, end: time.end.value };
    }
    case "allDay": {
      return {
        start: `${time.startDate.value}T00:00:00.000Z`,
        end: `${time.endDateExclusive.value}T00:00:00.000Z`,
      };
    }
    default: {
      return assertNever(time);
    }
  }
};

const expectedObservedIdentity = (event: RemoteEvent): SourceIdentity => {
  if (event.content.recurrence) {
    return { kind: "master", uid: event.uid };
  }
  const bounds = boundsOf(event.content.time);
  return {
    kind: "slot",
    uid: event.uid,
    start: { kind: "instant", value: bounds.start },
    end: { kind: "instant", value: bounds.end },
  };
};

const sameIdentity = (left: SourceIdentity, right: SourceIdentity): boolean =>
  expectedSourceIdentityKey(left) === expectedSourceIdentityKey(right);

export {
  expectedCalendarKeyString,
  expectedObservedIdentity,
  expectedSourceIdentityKey,
  nul,
  sameIdentity,
};
