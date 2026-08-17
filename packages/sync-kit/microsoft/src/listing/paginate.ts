import type { NotAttemptedReason, OperationContext } from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";
import { remainingMilliseconds } from "../client/deadline";
import type { MicrosoftClock } from "../dependencies";
import type { MicrosoftFailure } from "../errors/classify";

interface GraphPage {
  readonly items: readonly unknown[];
  readonly nextLink: string | null;
  readonly deltaLink: string | null;
}

type PageAnswer =
  | { readonly kind: "page"; readonly page: GraphPage }
  | { readonly kind: "failed"; readonly failure: MicrosoftFailure }
  | { readonly kind: "notAttempted"; readonly reason: NotAttemptedReason };

const walkStops = ["pageCeiling", "repeatedLink", "loopDeadline"] as const;
type WalkStop = (typeof walkStops)[number];

type PageWalk =
  | {
      readonly kind: "complete";
      readonly items: readonly unknown[];
      readonly deltaLink: string;
      readonly pagesFetched: number;
    }
  | {
      readonly kind: "truncated";
      readonly items: readonly unknown[];
      readonly nextLink: string;
      readonly pagesFetched: number;
      readonly stoppedBy: WalkStop;
    }
  | { readonly kind: "cursorLost" }
  | { readonly kind: "failed"; readonly failure: MicrosoftFailure }
  | { readonly kind: "notAttempted"; readonly reason: NotAttemptedReason };

interface PaginateOptions {
  readonly context: OperationContext;
  readonly clock: MicrosoftClock;
  readonly maxPages: number;
  readonly fetchPage: (link: string | null) => Promise<PageAnswer>;
}

interface WalkState {
  readonly collected: unknown[];
  readonly walked: Set<string>;
  link: string | null;
  pagesFetched: number;
}

const outOfTime = (options: PaginateOptions): boolean =>
  remainingMilliseconds(options.context, options.clock) <= 0;

const stoppedAt = (state: WalkState, stoppedBy: WalkStop): PageWalk => {
  if (state.link === null) {
    return { kind: "notAttempted", reason: "budgetExhausted" };
  }
  return {
    kind: "truncated",
    items: state.collected,
    nextLink: state.link,
    pagesFetched: state.pagesFetched,
    stoppedBy,
  };
};

const paginateGraph = async (options: PaginateOptions): Promise<PageWalk> => {
  const state: WalkState = { collected: [], walked: new Set(), link: null, pagesFetched: 0 };
  while (state.pagesFetched < options.maxPages) {
    if (outOfTime(options)) {
      return stoppedAt(state, "loopDeadline");
    }
    const answered: PageAnswer = await options.fetchPage(state.link);
    switch (answered.kind) {
      case "failed": {
        if (answered.failure.kind === "gone") {
          return { kind: "cursorLost" };
        }
        return { kind: "failed", failure: answered.failure };
      }
      case "notAttempted": {
        return { kind: "notAttempted", reason: answered.reason };
      }
      case "page": {
        state.pagesFetched += 1;
        state.collected.push(...answered.page.items);
        if (state.link !== null) {
          state.walked.add(state.link);
        }
        const { nextLink, deltaLink } = answered.page;
        if (nextLink === null) {
          if (deltaLink === null) {
            return { kind: "cursorLost" };
          }
          return {
            kind: "complete",
            items: state.collected,
            deltaLink,
            pagesFetched: state.pagesFetched,
          };
        }
        if (state.walked.has(nextLink)) {
          state.link = nextLink;
          return stoppedAt(state, "repeatedLink");
        }
        state.link = nextLink;
        break;
      }
      default: {
        return assertNever(answered);
      }
    }
  }
  return stoppedAt(state, "pageCeiling");
};

export { paginateGraph, walkStops };
export type { GraphPage, PageAnswer, PageWalk, PaginateOptions, WalkStop };
