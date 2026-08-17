import type {
  AccountId,
  Instant,
  CalendarKey,
  ListingScope,
  OperationName,
  ProviderFailure,
} from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";
import { caldavCapabilities } from "../capabilities";
import type { CalDAVFailure } from "./classify";

interface FailureSurroundings {
  readonly account: AccountId;
  readonly calendar: CalendarKey;
  readonly scope: ListingScope | null;
  readonly operation: OperationName;
}

const declaredThrottle = (status: number | null): boolean =>
  caldavCapabilities.throttleSignals.some((signal) => signal.status === status);

const transportFailure = (
  status: number | null,
  disposition: "transient" | "permanent",
): ProviderFailure => ({ kind: "transport", status, disposition });

const throttledFailure = (retryAfter: Instant | null): ProviderFailure => ({
  kind: "rateLimited",
  retryAfter,
  scope: caldavCapabilities.quotaScope,
});

const cursorFailure = (surroundings: FailureSurroundings): ProviderFailure => {
  if (!surroundings.scope) {
    return transportFailure(null, "transient");
  }
  return { kind: "cursorInvalid", scope: surroundings.scope };
};

const transientFailure = (status: number | null): ProviderFailure => {
  if (declaredThrottle(status)) {
    return throttledFailure(null);
  }
  return transportFailure(status, "transient");
};

const toProviderFailure = (
  failure: CalDAVFailure,
  surroundings: FailureSurroundings,
): ProviderFailure => {
  switch (failure.kind) {
    case "denied": {
      return { kind: "reauthRequired", account: surroundings.account };
    }
    case "credentialsWithheld": {
      return transportFailure(null, "permanent");
    }
    case "throttled": {
      return throttledFailure(failure.retryAfter);
    }
    case "tokenRejected": {
      return cursorFailure(surroundings);
    }
    case "truncated": {
      return transportFailure(507, "transient");
    }
    case "preconditionFailed": {
      return transportFailure(412, "permanent");
    }
    case "absent": {
      return { kind: "notFound", calendar: surroundings.calendar, event: null };
    }
    case "transient": {
      return transientFailure(failure.status);
    }
    case "permanent": {
      return transportFailure(failure.status, "permanent");
    }
    default: {
      return assertNever(failure);
    }
  }
};

export { toProviderFailure };
export type { FailureSurroundings };
