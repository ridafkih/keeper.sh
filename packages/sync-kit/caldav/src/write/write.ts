import type {
  OperationContext,
  Result,
  WriteIntent,
  WriteOutcome,
} from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";
import type { CalDAVInternals } from "../internals";
import { createResource } from "./create";
import { deleteResource } from "./delete";
import { writeSurroundings } from "./surroundings";
import { updateResource } from "./update";

const writeCalDAV = (
  internals: CalDAVInternals,
  intent: WriteIntent<"caldav">,
  context: OperationContext,
): Promise<Result<WriteOutcome>> => {
  const surroundings = writeSurroundings(internals, intent.calendar, context);
  switch (intent.kind) {
    case "create": {
      return createResource(surroundings, intent);
    }
    case "update": {
      return updateResource(surroundings, intent);
    }
    case "delete":
    case "retire": {
      return deleteResource(surroundings, intent);
    }
    default: {
      return assertNever(intent);
    }
  }
};

export { writeCalDAV };
