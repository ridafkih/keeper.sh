import type { CalendarKey, EventTime, TimeWindow, WindowMembership } from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";

type ProvenCoverage =
  | { readonly kind: "unproven" }
  | {
      readonly kind: "proven";
      readonly calendar: CalendarKey;
      readonly historic: TimeWindow;
      readonly future: TimeWindow;
    };

const insideProvenCoverage = (
  coverage: ProvenCoverage,
  time: EventTime,
  withinWindow: WindowMembership,
): boolean => {
  switch (coverage.kind) {
    case "unproven": {
      return false;
    }
    case "proven": {
      return withinWindow(coverage.historic, time) || withinWindow(coverage.future, time);
    }
    default: {
      return assertNever(coverage);
    }
  }
};

export { insideProvenCoverage };
export type { ProvenCoverage };
