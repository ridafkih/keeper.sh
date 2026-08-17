import type {
  AccountId,
  CalendarKey,
  ListingScope,
  OperationName,
  ProviderFailure,
} from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";
import type { MicrosoftFailure } from "./classify";

interface FailureSurroundings {
  readonly operation: OperationName;
  readonly account: AccountId;
  readonly calendar: CalendarKey | null;
  readonly scope: ListingScope | null;
}

const untypedStatuses = { gone: 410, notFound: 404, preconditionFailed: 412 } as const;

const duplicateObservation = {
  kind: "matchesFingerprint",
  fingerprint: { kind: "fingerprint", value: "duplicate" },
} as const;

const missingResource = (surroundings: FailureSurroundings): ProviderFailure => {
  if (surroundings.calendar === null) {
    return { kind: "transport", status: untypedStatuses.notFound, disposition: "permanent" };
  }
  return { kind: "notFound", calendar: surroundings.calendar, event: null };
};

const lostCursor = (surroundings: FailureSurroundings): ProviderFailure => {
  if (surroundings.scope === null) {
    return { kind: "transport", status: untypedStatuses.gone, disposition: "permanent" };
  }
  return { kind: "cursorInvalid", scope: surroundings.scope };
};

const toProviderFailure = (
  failure: MicrosoftFailure,
  surroundings: FailureSurroundings,
): ProviderFailure => {
  switch (failure.kind) {
    case "gone": {
      return lostCursor(surroundings);
    }
    case "notFound": {
      return missingResource(surroundings);
    }
    case "duplicate": {
      return { kind: "conflict", observed: duplicateObservation };
    }
    case "throttled": {
      return { kind: "rateLimited", retryAfter: failure.retryAfter, scope: "perMailbox" };
    }
    case "authRequired": {
      return { kind: "reauthRequired", account: surroundings.account };
    }
    case "conflict": {
      if (failure.version === null) {
        return {
          kind: "transport",
          status: untypedStatuses.preconditionFailed,
          disposition: "permanent",
        };
      }
      return { kind: "conflict", observed: { kind: "matchesVersion", version: failure.version } };
    }
    case "unsupported": {
      return { kind: "unsupported", operation: surroundings.operation };
    }
    case "transport": {
      return { kind: "transport", status: failure.status, disposition: failure.disposition };
    }
    default: {
      return assertNever(failure);
    }
  }
};

export { toProviderFailure };
export type { FailureSurroundings };
