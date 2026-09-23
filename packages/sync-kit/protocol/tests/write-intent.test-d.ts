import { describe, expectTypeOf, test } from "vitest";
import type {
  CalendarKey,
  CalendarProvider,
  DeleteHandle,
  EditableContent,
  IdempotencyKey,
  NormalizedContent,
  ObservedPrecondition,
  Provenance,
  RemoteEventId,
  RemoteVersion,
  WritableCalendar,
  WriteIntent,
} from "../src/index";

declare const calendar: WritableCalendar;
declare const calendarKey: CalendarKey;
declare const target: RemoteEventId;
declare const handle: DeleteHandle;
declare const normalized: NormalizedContent<"google">;
declare const rawContent: EditableContent;
declare const idempotencyKey: IdempotencyKey;
declare const ourProvenance: Extract<Provenance, { kind: "ours" }>;
declare const precondition: ObservedPrecondition;
declare const version: RemoteVersion;
declare const googleIntent: WriteIntent<"google">;

declare const acceptIntent: (intent: WriteIntent<"google">) => void;
declare const acceptOutlookIntent: (
  intent: Parameters<CalendarProvider<"outlook">["write"]>[0],
) => void;

describe("a write cannot be expressed without the guard it needs", () => {
  test("an update WriteIntent without a precondition does not compile", () => {
    // @ts-expect-error last-write-wins clobbers a change made in the provider UI
    acceptIntent({ kind: "update", calendar, target, content: normalized });
    expectTypeOf<
      Extract<WriteIntent<"google">, { kind: "update" }>["precondition"]
    >().toEqualTypeOf<ObservedPrecondition>();
  });

  test("an update pinned to absent is not expressible", () => {
    // @ts-expect-error "overwrite it if it isn't there" is last-write-wins spelled differently
    acceptIntent({
      kind: "update",
      calendar,
      target,
      content: normalized,
      precondition: { kind: "absent" },
    });
    // @ts-expect-error a delete guarded by absence deletes whatever it finds
    acceptIntent({
      kind: "delete",
      calendar,
      target: handle,
      reason: "sourceDeleted",
      precondition: { kind: "absent" },
    });
  });

  test("a delete WriteIntent without a precondition does not compile", () => {
    // @ts-expect-error a deleted remote event cannot be restored
    acceptIntent({ kind: "delete", calendar, target: handle, reason: "sourceDeleted" });
  });

  test("a retire WriteIntent without a precondition does not compile", () => {
    // @ts-expect-error retiring an object that changed after we read it is unrecoverable
    acceptIntent({ kind: "retire", calendar, target: handle, reason: "outsideWindow" });
  });

  test("a create's precondition can only be absent", () => {
    acceptIntent({
      kind: "create",
      calendar,
      idempotencyKey,
      content: normalized,
      provenance: ourProvenance,
      // @ts-expect-error a create must surface a collision, never overwrite it
      precondition: { kind: "matchesVersion", version },
    });
    expectTypeOf<
      Extract<WriteIntent<"google">, { kind: "create" }>["precondition"]
    >().toEqualTypeOf<{ readonly kind: "absent" }>();
  });

  test("a create without an idempotencyKey does not compile", () => {
    // @ts-expect-error a retried push without a key creates a visible duplicate
    acceptIntent({
      kind: "create",
      calendar,
      content: normalized,
      provenance: ourProvenance,
      precondition: { kind: "absent" },
    });
  });

  test("a calendar we only ever read cannot be written to", () => {
    acceptIntent({
      kind: "update",
      // @ts-expect-error the access we discovered at enumeration must survive to the write
      calendar: { key: calendarKey, access: "readOnly" },
      target,
      content: normalized,
      precondition,
    });
    // @ts-expect-error a bare key has forgotten whether we may write to it
    acceptIntent({ kind: "update", calendar: calendarKey, target, content: normalized, precondition });
    expectTypeOf<WritableCalendar["access"]>().toEqualTypeOf<"readWrite">();
  });

  test("unnormalized EditableContent cannot reach a write", () => {
    acceptIntent({
      kind: "update",
      calendar,
      target,
      precondition,
      // @ts-expect-error only provider.normalize may mint the content a write carries
      content: rawContent,
    });
  });

  test("content normalized for one provider cannot be written to another", () => {
    // @ts-expect-error google-shaped normalization diverges on every echo from outlook
    acceptOutlookIntent(googleIntent);
  });
});
