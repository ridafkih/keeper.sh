import type { EventUid, RemoteEventId } from "./handles";

interface BoundedSample {
  readonly sample: readonly string[];
  readonly total: number;
}

const withholdReasons = [
  "unparseable",
  "unresolvableTimeZone",
  "unrepresentableTime",
  "recurrenceBudgetExceeded",
  "supersededRevisionUnbuildable",
  "unsupportedRecurrenceRange",
  "unsupportedRecurrenceDates",
  "missingIdentity",
  "selfAuthored",
] as const;
type WithholdReason = (typeof withholdReasons)[number];

type WithheldIdentity =
  | { readonly uid: EventUid; readonly id: RemoteEventId | null }
  | { readonly uid: null; readonly id: RemoteEventId };

type WithheldEvent = WithheldIdentity & { readonly reason: WithholdReason };

interface ListingDiagnostics {
  readonly withheld: BoundedSample;
  readonly selfAuthored: BoundedSample;
  readonly unrepresentable: BoundedSample;
  readonly pagesFetched: number;
}

export { withholdReasons };
export type {
  BoundedSample,
  ListingDiagnostics,
  WithheldEvent,
  WithheldIdentity,
  WithholdReason,
};
