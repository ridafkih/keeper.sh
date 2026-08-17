import type {
  AccountId,
  CalendarKey,
  ListingScope,
  OperationName,
  ProviderFailure,
} from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";
import type { GoogleFailure } from "./classify";

interface FailureSurroundings {
  readonly operation: OperationName;
  readonly calendar: CalendarKey | null;
  readonly account: AccountId;
  readonly scope: ListingScope | null;
}

const missingResource = (surroundings: FailureSurroundings): ProviderFailure => {
  if (surroundings.calendar === null) {
    return { kind: "transport", status: 404, disposition: "permanent" };
  }
  return { kind: "notFound", calendar: surroundings.calendar, event: null };
};

const lostCursor = (surroundings: FailureSurroundings): ProviderFailure => {
  const { scope } = surroundings;
  if (scope === null) {
    return { kind: "transport", status: 410, disposition: "permanent" };
  }
  return { kind: "cursorInvalid", scope };
};

const toProviderFailure = (
  failure: GoogleFailure,
  surroundings: FailureSurroundings,
): ProviderFailure => {
  switch (failure.kind) {
    case "cursorLost": {
      return lostCursor(surroundings);
    }
    case "resourceGone":
    case "notFound": {
      return missingResource(surroundings);
    }
    case "rateLimited": {
      return { kind: "rateLimited", retryAfter: failure.retryAfter, scope: "perUser" };
    }
    case "conflict": {
      return { kind: "transport", status: 409, disposition: "permanent" };
    }
    case "preconditionFailed": {
      if (failure.version === null) {
        return { kind: "transport", status: 412, disposition: "permanent" };
      }
      return {
        kind: "conflict",
        observed: { kind: "matchesVersion", version: failure.version },
      };
    }
    case "authExpired": {
      return { kind: "reauthRequired", account: surroundings.account };
    }
    case "unsupported": {
      return { kind: "unsupported", operation: surroundings.operation };
    }
    case "transient": {
      return { kind: "transport", status: failure.status, disposition: "transient" };
    }
    case "permanent": {
      return { kind: "transport", status: failure.status, disposition: "permanent" };
    }
    default: {
      return assertNever(failure);
    }
  }
};

export { toProviderFailure };
export type { FailureSurroundings };
