import type { KnownMirror } from "@keeper.sh/sync-conformance";
import type {
  ChangeListing,
  Continuation,
  RemoteEvent,
  Result,
  SyncCursor,
  WriteOutcome,
} from "@keeper.sh/sync-protocol";
import { caldavCalendar } from "./harness";

const listingOf = (result: Result<ChangeListing>): ChangeListing => {
  if (!result.ok) {
    throw new Error(`the listing failed as "${result.failure.kind}" where it had to succeed`);
  }
  return result.value;
};

const outcomeOf = (result: Result<WriteOutcome>): WriteOutcome => {
  if (!result.ok) {
    throw new Error(`the write failed as "${result.failure.kind}" where it had to succeed`);
  }
  return result.value;
};

const cursorOf = (listing: ChangeListing): SyncCursor => {
  if (!listing.cursor) {
    throw new Error(`a "${listing.kind}" listing carried no cursor to resume from`);
  }
  return listing.cursor;
};

const continuationOf = (listing: ChangeListing): Continuation => {
  if (!listing.continuation) {
    throw new Error(`a "${listing.kind}" listing carried no continuation to resume from`);
  }
  return listing.continuation;
};

const failureKindOf = (result: Result<unknown>): string => {
  if (result.ok) {
    return "ok";
  }
  return result.failure.kind;
};

const outcomeKindOf = (result: Result<WriteOutcome>): string => {
  if (!result.ok) {
    return `failure:${result.failure.kind}`;
  }
  return result.value.kind;
};

const timeOf = (event: RemoteEvent): KnownMirror["entries"][number]["time"] => {
  const { content } = event;
  if (content.recurrence === null) {
    return content.time;
  }
  throw new Error("a recurring event has no single time to place in a known mirror");
};

const knownMirrorOf = (events: readonly RemoteEvent[]): KnownMirror => ({
  calendar: caldavCalendar,
  entries: events.map((event) => ({ uid: event.uid.value, id: event.id, time: timeOf(event) })),
});

export {
  continuationOf,
  cursorOf,
  failureKindOf,
  knownMirrorOf,
  listingOf,
  outcomeKindOf,
  outcomeOf,
};
