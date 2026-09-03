import { describe, expectTypeOf, test } from "vitest";
import type {
  AccountId,
  CalendarDate,
  CalendarId,
  CalendarKey,
  Continuation,
  DeleteHandle,
  EventTime,
  EventUid,
  Fingerprint,
  IdempotencyKey,
  Instant,
  RemoteEventId,
  RemoteVersion,
  SyncCursor,
} from "../src/index";

declare const remoteEventId: RemoteEventId;
declare const deleteHandle: DeleteHandle;
declare const eventUid: EventUid;
declare const fingerprint: Fingerprint;
declare const syncCursor: SyncCursor;
declare const continuation: Continuation;
declare const accountId: AccountId;
declare const calendarId: CalendarId;
declare const instant: Instant;
declare const calendarDate: CalendarDate;

declare const acceptRemoteEventId: (identifier: RemoteEventId) => void;
declare const acceptDeleteHandle: (handle: DeleteHandle) => void;
declare const acceptEventUid: (uid: EventUid) => void;
declare const acceptRemoteVersion: (version: RemoteVersion) => void;
declare const acceptIdempotencyKey: (key: IdempotencyKey) => void;
declare const acceptSyncCursor: (cursor: SyncCursor) => void;
declare const acceptContinuation: (token: Continuation) => void;
declare const acceptCalendarId: (calendar: CalendarId) => void;
declare const acceptCalendarKey: (key: CalendarKey) => void;
declare const acceptInstant: (moment: Instant) => void;
declare const acceptEventTime: (time: EventTime) => void;

describe("identifiers are not interchangeable", () => {
  test("a RemoteEventId and a DeleteHandle cannot be swapped", () => {
    // @ts-expect-error the identifier you read an event by is not the handle you delete it by
    acceptDeleteHandle(remoteEventId);
    // @ts-expect-error the handle you delete an event by is not the identifier you read it by
    acceptRemoteEventId(deleteHandle);
  });

  test("an EventUid is not a RemoteEventId", () => {
    // @ts-expect-error the iCalendar UID is not the provider's own resource identifier
    acceptRemoteEventId(eventUid);
    // @ts-expect-error the provider's resource identifier is not the iCalendar UID
    acceptEventUid(remoteEventId);
  });

  test("a Fingerprint is not a RemoteVersion", () => {
    // @ts-expect-error our content hash is not the provider's concurrency token
    acceptRemoteVersion(fingerprint);
  });

  test("a bare string is not an IdempotencyKey", () => {
    // @ts-expect-error an idempotency key is minted and validated, never an arbitrary string
    acceptIdempotencyKey("keeper-mirror-1");
  });

  test("a Continuation is not assignable to a SyncCursor and vice versa", () => {
    // @ts-expect-error resuming a delta with a pagination token silently skips changes
    acceptSyncCursor(continuation);
    // @ts-expect-error persisting a page token as a sync cursor never terminates
    acceptContinuation(syncCursor);
  });

  test("an AccountId is not a CalendarId, and the three parts of a key cannot be permuted", () => {
    // @ts-expect-error the account a calendar belongs to is not the calendar
    acceptCalendarId(accountId);
    // @ts-expect-error two users holding one provider account collide unless the parts are distinct
    acceptCalendarKey({ provider: "google", account: calendarId, calendar: accountId });
  });

  test("an Instant is not a CalendarDate", () => {
    // @ts-expect-error a DATE-TIME written into a DATE field moves the event by the zone offset
    acceptEventTime({ kind: "allDay", startDate: instant, endDateExclusive: instant });
    // @ts-expect-error a floating DATE is not a point on the timeline
    acceptInstant(calendarDate);
  });

  test("every handle is a tagged object carrying its own discriminant", () => {
    expectTypeOf<RemoteEventId>().toEqualTypeOf<{
      readonly kind: "remoteEventId";
      readonly value: string;
    }>();
    expectTypeOf<DeleteHandle>().toEqualTypeOf<{
      readonly kind: "deleteHandle";
      readonly value: string;
    }>();
    expectTypeOf<IdempotencyKey>().toEqualTypeOf<{
      readonly kind: "idempotencyKey";
      readonly value: string;
    }>();
    expectTypeOf<Instant>().toEqualTypeOf<{ readonly kind: "instant"; readonly value: string }>();
    expectTypeOf<CalendarDate>().toEqualTypeOf<{
      readonly kind: "calendarDate";
      readonly value: string;
    }>();
  });

  test("a version and a fingerprint are separate facts about the same event", () => {
    expectTypeOf<RemoteVersion>().toEqualTypeOf<{
      readonly kind: "remoteVersion";
      readonly value: string;
    }>();
    expectTypeOf<Fingerprint>().toEqualTypeOf<{
      readonly kind: "fingerprint";
      readonly value: string;
    }>();
  });
});
