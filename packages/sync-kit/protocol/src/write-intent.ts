import type { WritableCalendar } from "./calendar-ref";
import type {
  DeleteHandle,
  Fingerprint,
  IdempotencyKey,
  ProviderId,
  RemoteEventId,
} from "./handles";
import type { ObservedPrecondition, Precondition } from "./precondition";
import type { EditableContent, MirrorSource, Provenance } from "./remote-event";

interface NormalizedContent<Provider extends ProviderId = ProviderId> {
  readonly kind: "normalized";
  readonly provider: Provider;
  readonly content: EditableContent;
  readonly fingerprint: Fingerprint;
}

const deleteReasons = ["sourceDeleted", "sourceUnmapped"] as const;
type DeleteReason = (typeof deleteReasons)[number];

const retireReasons = ["outsideWindow", "destinationDisconnected"] as const;
type RetireReason = (typeof retireReasons)[number];

type WriteIntent<Provider extends ProviderId = ProviderId> =
  | {
      readonly kind: "create";
      readonly calendar: WritableCalendar;
      readonly idempotencyKey: IdempotencyKey;
      readonly content: NormalizedContent<Provider>;
      readonly provenance: Extract<Provenance, { kind: "ours" }>;
      readonly precondition: Extract<Precondition, { kind: "absent" }>;
      readonly target?: never;
    }
  | {
      readonly kind: "update";
      readonly calendar: WritableCalendar;
      readonly target: RemoteEventId;
      readonly content: NormalizedContent<Provider>;
      readonly precondition: ObservedPrecondition;
    }
  | {
      readonly kind: "delete";
      readonly calendar: WritableCalendar;
      readonly target: DeleteHandle;
      readonly precondition: ObservedPrecondition;
      readonly reason: DeleteReason;
      readonly content?: never;
    }
  | {
      readonly kind: "retire";
      readonly calendar: WritableCalendar;
      readonly target: DeleteHandle;
      readonly precondition: ObservedPrecondition;
      readonly reason: RetireReason;
      readonly content?: never;
    };

type BuildMirrorIntent<Provider extends ProviderId = ProviderId> = (
  source: MirrorSource,
  destination: WritableCalendar,
  normalized: NormalizedContent<Provider>,
) => WriteIntent<Provider>;

export { deleteReasons, retireReasons };
export type { BuildMirrorIntent, DeleteReason, NormalizedContent, RetireReason, WriteIntent };
