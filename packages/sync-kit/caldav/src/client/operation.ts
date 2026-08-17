import type { OperationContext } from "@keeper.sh/sync-protocol";
import type { FailureSurroundings } from "../errors/to-provider-failure";

interface CalDAVOperation {
  readonly context: OperationContext;
  readonly surroundings: FailureSurroundings;
}

const beginOperation = (
  context: OperationContext,
  surroundings: FailureSurroundings,
): CalDAVOperation => ({ context, surroundings });

export { beginOperation };
export type { CalDAVOperation };
