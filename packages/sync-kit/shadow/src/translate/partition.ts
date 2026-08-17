import type { CalendarKey } from "@keeper.sh/sync-protocol";
import { calendarKeyString } from "@keeper.sh/sync-reconcile";
import type { MirrorRow, StoredSourceEvent } from "../input/destination-sync-input";
import type { StoredSourceCoverage } from "../input/stored-coverage";

interface SourcePartition {
  readonly sourceCalendar: CalendarKey;
  readonly storedSourceEvents: readonly StoredSourceEvent[];
  readonly mirrors: readonly MirrorRow[];
  readonly storedCoverage: StoredSourceCoverage | null;
}

interface PartitionRequest {
  readonly mappedSourceCalendars: readonly CalendarKey[];
  readonly storedSourceEvents: readonly StoredSourceEvent[];
  readonly mirrors: readonly MirrorRow[];
  readonly storedCoverage: readonly StoredSourceCoverage[];
}

const partitionFor = (
  sourceCalendar: CalendarKey,
  request: PartitionRequest,
): SourcePartition => {
  const wanted = calendarKeyString(sourceCalendar);
  return {
    sourceCalendar,
    storedSourceEvents: request.storedSourceEvents.filter(
      (stored) => calendarKeyString(stored.sourceCalendar) === wanted,
    ),
    mirrors: request.mirrors.filter(
      (mirror) => calendarKeyString(mirror.sourceCalendar) === wanted,
    ),
    storedCoverage:
      request.storedCoverage.find((row) => calendarKeyString(row.calendar) === wanted) ?? null,
  };
};

const partitionBySourceCalendar = (request: PartitionRequest): readonly SourcePartition[] =>
  request.mappedSourceCalendars.map((sourceCalendar) => partitionFor(sourceCalendar, request));

export { partitionBySourceCalendar };
export type { PartitionRequest, SourcePartition };
