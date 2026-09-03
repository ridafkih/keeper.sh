import type {
  ChangeListing,
  Continuation,
  ListingScope,
  ProviderFailure,
  ProviderId,
  Result,
  SyncCursor,
  WriteIntent,
  WriteOutcome,
} from "@keeper.sh/sync-protocol";
import type { ConformanceEnvironment, ProviderUnderTest } from "../../src/options";
import { contextOf } from "./protocol";

interface DriveOptions {
  readonly signal?: AbortSignal;
  readonly deadlineMs?: number;
  readonly maxAttempts?: number;
  readonly retryDelayCeilingMs?: number;
}

const contextFrom = (environment: ConformanceEnvironment, options: DriveOptions) =>
  contextOf({
    now: environment.clock.now,
    signal: options.signal ?? new AbortController().signal,
    deadlineMs: options.deadlineMs,
    maxAttempts: options.maxAttempts,
    retryDelayCeilingMs: options.retryDelayCeilingMs,
  });

const listChanges = <Provider extends ProviderId>(
  provider: ProviderUnderTest<Provider>,
  environment: ConformanceEnvironment,
  scope: ListingScope,
  resume: SyncCursor | Continuation | null = null,
  options: DriveOptions = {},
): Promise<Result<ChangeListing>> =>
  provider.contract.provider.listChanges({ scope, resume }, contextFrom(environment, options));

const write = <Provider extends ProviderId>(
  provider: ProviderUnderTest<Provider>,
  environment: ConformanceEnvironment,
  intent: WriteIntent<Provider>,
  options: DriveOptions = {},
): Promise<Result<WriteOutcome>> =>
  provider.contract.provider.write(intent, contextFrom(environment, options));

const listingKindOf = (result: Result<ChangeListing>): string => {
  if (result.ok) {
    return result.value.kind;
  }
  return `failure:${result.failure.kind}`;
};

const okValue = <Value>(result: Result<Value>): Value => {
  if (result.ok) {
    return result.value;
  }
  throw new Error(`expected an ok Result, observed failure "${result.failure.kind}"`);
};

const failureOf = <Value>(result: Result<Value>): ProviderFailure => {
  if (result.ok) {
    throw new Error("expected a failed Result, observed ok");
  }
  return result.failure;
};

export { contextFrom, failureOf, listChanges, listingKindOf, okValue, write };
export type { DriveOptions };
