import type { EventTime, Instant } from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";
import type { SourceIdentity } from "@keeper.sh/sync-reconcile";
import type { DestinationSyncInput } from "../input/destination-sync-input";
import type { StoredSourceCoverage } from "../input/stored-coverage";
import type { ShadowOptions } from "../options";
import { isCanonicalUtcInstant, isRecordedInstant } from "../time/instant";

const instantsOfTime = (time: EventTime): readonly Instant[] => {
  switch (time.kind) {
    case "timed": {
      return [time.start, time.end];
    }
    case "allDay": {
      return [];
    }
    default: {
      return assertNever(time);
    }
  }
};

const instantsOfIdentity = (identity: SourceIdentity): readonly Instant[] => {
  switch (identity.kind) {
    case "master": {
      return [];
    }
    case "override": {
      return [identity.recurrenceInstant];
    }
    case "slot": {
      return [identity.start, identity.end];
    }
    default: {
      return assertNever(identity);
    }
  }
};

const instantsOfCoverage = (stored: StoredSourceCoverage): readonly Instant[] =>
  [
    stored.ingestWindowStart,
    stored.ingestWindowEnd,
    stored.ingestWindowRecordedAt,
    stored.historicRange?.start,
    stored.historicRange?.end,
    stored.futureRange?.start,
    stored.futureRange?.end,
  ].filter((instant) => isRecordedInstant(instant));

const instantsOfInput = (
  input: DestinationSyncInput,
  options: ShadowOptions,
): readonly Instant[] => [
  input.mirrorWindow.start,
  input.mirrorWindow.end,
  options.asOf,
  ...input.storedCoverage.flatMap((stored) => instantsOfCoverage(stored)),
  ...input.storedSourceEvents.flatMap((stored) => instantsOfTime(stored.time)),
  ...input.mirrors.flatMap((mirror) => instantsOfIdentity(mirror.sourceIdentity)),
  ...input.mirrors.flatMap((mirror) => instantsOfTime(mirror.mirroredTime)),
];

const nonCanonicalInstantIn = (
  input: DestinationSyncInput,
  options: ShadowOptions,
): Instant | null =>
  instantsOfInput(input, options).find((instant) => !isCanonicalUtcInstant(instant)) ?? null;

export { nonCanonicalInstantIn };
