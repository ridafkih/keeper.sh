import { assertNever } from "@keeper.sh/sync-protocol";
import type { EventIdentity } from "../parse/identity";
import type { VeventOutcome } from "../parse/parse-vevent";

const identityOfOutcome = (outcome: VeventOutcome): readonly EventIdentity[] => {
  switch (outcome.kind) {
    case "parsed": {
      return [outcome.event.identity];
    }
    case "selfAuthored": {
      return [outcome.identity];
    }
    case "withheld": {
      if (!outcome.identity.uid) {
        return [];
      }
      return [{ kind: "master", uid: outcome.identity.uid }];
    }
    default: {
      return assertNever(outcome);
    }
  }
};

const presentIdentities = (outcomes: readonly VeventOutcome[]): readonly EventIdentity[] =>
  outcomes.flatMap((outcome) => identityOfOutcome(outcome));

const usableIdentities = (outcomes: readonly VeventOutcome[]): readonly EventIdentity[] =>
  outcomes.flatMap((outcome) => {
    if (outcome.kind !== "parsed") {
      return [];
    }
    return [outcome.event.identity];
  });

export { identityOfOutcome, presentIdentities, usableIdentities };
