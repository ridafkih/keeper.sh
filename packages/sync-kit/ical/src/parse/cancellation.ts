import type { Instant } from "@keeper.sh/sync-protocol";
import type { ParsedVevent } from "./parse-vevent";

interface CancellationResolution {
  readonly surviving: readonly ParsedVevent[];
  readonly cancellations: readonly Instant[];
}

const isOverride = (event: ParsedVevent): boolean => event.identity.kind === "override";

const overrideInstantOf = (event: ParsedVevent): Instant | null => {
  if (event.identity.kind !== "override") {
    return null;
  }
  return event.identity.recurrenceInstant;
};

const applyCancellations = (events: readonly ParsedVevent[]): CancellationResolution => {
  const series = events.filter((event) => !isOverride(event));
  const overrides = events.filter((event) => isOverride(event));
  if (series.some((event) => event.cancelled)) {
    return { surviving: [], cancellations: [] };
  }
  const cancelledOverrides = overrides.filter((event) => event.cancelled);
  return {
    surviving: [...series, ...overrides.filter((event) => !event.cancelled)],
    cancellations: cancelledOverrides.flatMap((event) => {
      const instant = overrideInstantOf(event);
      if (!instant) {
        return [];
      }
      return [instant];
    }),
  };
};

export { applyCancellations };
export type { CancellationResolution };
