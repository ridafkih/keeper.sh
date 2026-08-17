import type { OperationContext, Result, WriteIntent, WriteOutcome } from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";
import { createInGraph } from "./create";
import { deleteInGraph } from "./delete";
import type { WriteSurroundings } from "./surroundings";
import { updateInGraph } from "./update";

const writeToGraph = (
  intent: WriteIntent<"microsoft">,
  context: OperationContext,
  surroundings: WriteSurroundings,
): Promise<Result<WriteOutcome>> => {
  switch (intent.kind) {
    case "create": {
      return createInGraph(intent, context, surroundings);
    }
    case "update": {
      return updateInGraph(intent, context, surroundings);
    }
    case "delete":
    case "retire": {
      return deleteInGraph(intent, context, surroundings);
    }
    default: {
      return assertNever(intent);
    }
  }
};

export { writeToGraph };
