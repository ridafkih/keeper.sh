import type { OperationContext, WritableCalendar } from "@keeper.sh/sync-protocol";
import type { CalDAVOperation } from "../client/operation";
import { beginOperation } from "../client/operation";
import { normalizeCollectionKey } from "../identity/collection-key";
import type { CalDAVInternals } from "../internals";

interface WriteSurroundings {
  readonly internals: CalDAVInternals;
  readonly calendar: WritableCalendar;
  readonly collectionPath: string;
  readonly context: OperationContext;
  readonly run: CalDAVOperation;
}

const writeSurroundings = (
  internals: CalDAVInternals,
  calendar: WritableCalendar,
  context: OperationContext,
): WriteSurroundings => ({
  internals,
  calendar,
  collectionPath: normalizeCollectionKey(
    calendar.key.calendar.value,
    internals.dependencies.credentials.serverUrl,
  ).value,
  context,
  run: beginOperation(context, {
    account: calendar.key.account,
    calendar: calendar.key,
    scope: null,
    operation: "write",
  }),
});

export { writeSurroundings };
export type { WriteSurroundings };
