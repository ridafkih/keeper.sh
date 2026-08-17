import { assertNever } from "@keeper.sh/sync-protocol";

const graphLifecycleEvents = ["reauthorizationRequired", "subscriptionRemoved", "missed"] as const;

type GraphLifecycleEvent = (typeof graphLifecycleEvents)[number];

const cursorEffects = ["keep", "reset"] as const;
type CursorEffect = (typeof cursorEffects)[number];

interface LifecycleOutcome {
  readonly event: GraphLifecycleEvent;
  readonly schedulesIngest: boolean;
  readonly cursorEffect: CursorEffect;
  readonly marksChannel: "reauthorizationRequired" | "removed" | "unchanged";
}

const lifecycleOutcomeOf = (event: GraphLifecycleEvent): LifecycleOutcome => {
  switch (event) {
    case "missed": {
      return {
        event,
        schedulesIngest: true,
        cursorEffect: "keep",
        marksChannel: "unchanged",
      };
    }
    case "reauthorizationRequired": {
      return {
        event,
        schedulesIngest: false,
        cursorEffect: "keep",
        marksChannel: "reauthorizationRequired",
      };
    }
    case "subscriptionRemoved": {
      return {
        event,
        schedulesIngest: true,
        cursorEffect: "reset",
        marksChannel: "removed",
      };
    }
    default: {
      return assertNever(event);
    }
  }
};

const readLifecycleEvent = (presented: unknown): GraphLifecycleEvent | null =>
  graphLifecycleEvents.find((candidate) => candidate === presented) ?? null;

export { cursorEffects, graphLifecycleEvents, lifecycleOutcomeOf, readLifecycleEvent };
export type { CursorEffect, GraphLifecycleEvent, LifecycleOutcome };
