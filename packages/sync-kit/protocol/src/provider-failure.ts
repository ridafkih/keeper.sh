import type { CalendarKey } from "./calendar-ref";
import type { Continuation, ListingScope } from "./change-listing";
import type { AccountId, Instant, RemoteEventId } from "./handles";
import type { ObservedPrecondition } from "./precondition";
import type { NotAttemptedReason, RepresentabilityConstraint } from "./write-outcome";

const quotaScopes = ["perUser", "perMailbox", "perCollection"] as const;
type QuotaScope = (typeof quotaScopes)[number];

const operationNames = ["listCalendars", "listChanges", "normalize", "write"] as const;
type OperationName = (typeof operationNames)[number];

const transportDispositions = ["transient", "permanent"] as const;
type TransportDisposition = (typeof transportDispositions)[number];

type ProviderFailure =
  | { readonly kind: "reauthRequired"; readonly account: AccountId }
  | {
      readonly kind: "rateLimited";
      readonly retryAfter: Instant | null;
      readonly scope: QuotaScope;
    }
  | { readonly kind: "cursorInvalid"; readonly scope: ListingScope }
  | { readonly kind: "truncated"; readonly continuation: Continuation }
  | { readonly kind: "conflict"; readonly observed: ObservedPrecondition }
  | {
      readonly kind: "notFound";
      readonly calendar: CalendarKey;
      readonly event: RemoteEventId | null;
    }
  | { readonly kind: "unsupported"; readonly operation: OperationName }
  | { readonly kind: "unrepresentable"; readonly constraint: RepresentabilityConstraint }
  | {
      readonly kind: "transport";
      readonly status: number | null;
      readonly disposition: TransportDisposition;
    }
  | { readonly kind: "notAttempted"; readonly reason: NotAttemptedReason };

export { operationNames, quotaScopes, transportDispositions };
export type { OperationName, ProviderFailure, QuotaScope, TransportDisposition };
