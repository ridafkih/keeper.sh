import type { CalendarEnumeration } from "./calendar-ref";
import type { Capabilities } from "./capabilities";
import type { ChangeListing, Continuation, ListingScope, SyncCursor } from "./change-listing";
import type { FingerprintContract, ProviderConformanceSuite } from "./conformance";
import type { AccountId, Instant, ProviderId } from "./handles";
import type { EditableContent } from "./remote-event";
import type { Result } from "./result";
import type { NormalizedContent, WriteIntent } from "./write-intent";
import type { WriteOutcome } from "./write-outcome";

interface RetryBudget {
  readonly maxAttempts: number;
  readonly retryDelayCeilingMs: number;
}

interface OperationContext {
  readonly signal: AbortSignal;
  readonly now: () => Instant;
  readonly deadline: Instant;
  readonly retryBudget: RetryBudget;
}

interface ListChangesRequest {
  readonly scope: ListingScope;
  readonly resume: SyncCursor | Continuation | null;
}

interface CalendarProvider<Provider extends ProviderId = ProviderId> {
  readonly capabilities: Capabilities<Provider>;
  readonly listCalendars: (
    account: AccountId,
    context: OperationContext,
  ) => Promise<Result<CalendarEnumeration>>;
  readonly listChanges: (
    request: ListChangesRequest,
    context: OperationContext,
  ) => Promise<Result<ChangeListing>>;
  readonly normalize: (content: EditableContent) => Result<NormalizedContent<Provider>>;
  readonly write: (
    intent: WriteIntent<Provider>,
    context: OperationContext,
  ) => Promise<Result<WriteOutcome>>;
}

interface ProviderContract<Provider extends ProviderId = ProviderId> {
  readonly provider: CalendarProvider<Provider>;
  readonly fingerprint: FingerprintContract;
  readonly conformance: ProviderConformanceSuite;
}

export type {
  CalendarProvider,
  ListChangesRequest,
  OperationContext,
  ProviderContract,
  RetryBudget,
};
