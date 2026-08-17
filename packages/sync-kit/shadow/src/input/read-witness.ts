import type { CalendarKey } from "@keeper.sh/sync-protocol";

interface SourceReadWitness {
  readonly sourceCalendarsBeforeRemoteRead: readonly CalendarKey[];
  readonly sourceCalendarsAtLocalRead: readonly CalendarKey[];
  readonly coverageNarrowedAfterRemoteRead: true;
}

export type { SourceReadWitness };
