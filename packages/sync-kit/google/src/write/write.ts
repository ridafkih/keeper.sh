import type {
  OperationContext,
  Result,
  WriteIntent,
  WriteOutcome,
} from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";
import { createEvent } from "./create";
import { deleteEvent } from "./delete";
import type { WriteSurroundings } from "./surroundings";
import { updateEvent } from "./update";

const writeToGoogle = (
  intent: WriteIntent<"google">,
  context: OperationContext,
  surroundings: WriteSurroundings,
): Promise<Result<WriteOutcome>> => {
  switch (intent.kind) {
    case "create": {
      return createEvent(intent, context, surroundings);
    }
    case "update": {
      return updateEvent(intent, context, surroundings);
    }
    case "delete":
    case "retire": {
      return deleteEvent(intent, context, surroundings);
    }
    default: {
      return assertNever(intent);
    }
  }
};

export { writeToGoogle };
