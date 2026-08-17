import type { CalendarKey } from "@keeper.sh/sync-protocol";
import { calendarKeyString, sourceIdentityKey } from "@keeper.sh/sync-reconcile";
import type { DestinationSyncInput, MirrorRow } from "../input/destination-sync-input";
import { countsAgreeWithTheWithheldList, withheldTotalOf } from "../input/read-completeness";
import type { ShadowOptions } from "../options";
import { compareCanonicalUtcInstants } from "../time/instant";
import { nonCanonicalInstantIn } from "./instants";
import type { TranslationRefusal } from "./refusal";

interface Refusal {
  readonly reason: TranslationRefusal;
  readonly detail: string;
}

const refusal = (reason: TranslationRefusal, detail: string): Refusal => ({ reason, detail });

const calendarKeySet = (calendars: readonly CalendarKey[]): ReadonlySet<string> =>
  new Set(calendars.map((calendar) => calendarKeyString(calendar)));

const sameCalendarSet = (
  left: readonly CalendarKey[],
  right: readonly CalendarKey[],
): boolean => {
  const wanted = calendarKeySet(left);
  const found = calendarKeySet(right);
  if (wanted.size !== found.size) {
    return false;
  }
  return [...wanted].every((key) => found.has(key));
};

const mirrorClaimKey = (mirror: MirrorRow): string =>
  `${calendarKeyString(mirror.sourceCalendar)}/${sourceIdentityKey(mirror.sourceIdentity)}`;

const duplicateClaimIn = (mirrors: readonly MirrorRow[]): string | null => {
  const claimed = new Set<string>();
  for (const mirror of mirrors) {
    const key = mirrorClaimKey(mirror);
    if (claimed.has(key)) {
      return key;
    }
    claimed.add(key);
  }
  return null;
};

const sourceWithoutStoredCoverage = (input: DestinationSyncInput): CalendarKey | null => {
  const recorded = calendarKeySet(input.storedCoverage.map((stored) => stored.calendar));
  return (
    input.mappedSourceCalendars.find((calendar) => !recorded.has(calendarKeyString(calendar))) ??
    null
  );
};

const rowOutsideTheMappedSources = (input: DestinationSyncInput): string | null => {
  const mapped = calendarKeySet(input.mappedSourceCalendars);
  const claimed: readonly { readonly what: string; readonly calendar: CalendarKey }[] = [
    ...input.storedSourceEvents.map((stored) => ({
      what: `the stored source event ${stored.id.value}`,
      calendar: stored.sourceCalendar,
    })),
    ...input.mirrors.map((mirror) => ({
      what: `the mirror of ${sourceIdentityKey(mirror.sourceIdentity)}`,
      calendar: mirror.sourceCalendar,
    })),
    ...input.completeness.withheld.map((withheld) => ({
      what: "a withheld source row",
      calendar: withheld.sourceCalendar,
    })),
  ];
  const stray = claimed.find((row) => !mapped.has(calendarKeyString(row.calendar)));
  if (!stray) {
    return null;
  }
  return `${stray.what} names ${calendarKeyString(stray.calendar)}`;
};

const mirrorOfAnotherDestination = (input: DestinationSyncInput): MirrorRow | null => {
  const wanted = calendarKeyString(input.destination.key);
  return (
    input.mirrors.find((mirror) => calendarKeyString(mirror.destinationCalendar) !== wanted) ?? null
  );
};

const storedEventWithoutAPayload = (input: DestinationSyncInput): string | null =>
  input.storedSourceEvents.find((stored) => (stored.canonical ?? null) === null)?.id.value ?? null;

const witnessRefusal = (input: DestinationSyncInput): Refusal | null => {
  const { witness } = input;
  if (
    sameCalendarSet(witness.sourceCalendarsBeforeRemoteRead, witness.sourceCalendarsAtLocalRead)
  ) {
    return null;
  }
  return refusal(
    "sourceCalendarSetChangedDuringRead",
    "the mapped source calendar set changed between the destination read and the local read",
  );
};

const identityRefusal = (input: DestinationSyncInput): Refusal | null => {
  const duplicate = duplicateClaimIn(input.mirrors);
  if (!duplicate) {
    return null;
  }
  return refusal(
    "duplicateSourceIdentityClaim",
    `two mirrors claim the source identity ${duplicate}`,
  );
};

const membershipRefusal = (input: DestinationSyncInput): Refusal | null => {
  const stray = rowOutsideTheMappedSources(input);
  if (!stray) {
    return null;
  }
  return refusal("rowOnAnUnmappedSourceCalendar", `${stray}, which is not a mapped source`);
};

const coverageRefusal = (input: DestinationSyncInput): Refusal | null => {
  const missing = sourceWithoutStoredCoverage(input);
  if (!missing) {
    return null;
  }
  return refusal(
    "storedCoverageMissingForMappedSource",
    `no ingest coverage was recorded for ${calendarKeyString(missing)}`,
  );
};

const completenessRefusal = (input: DestinationSyncInput): Refusal | null => {
  if (countsAgreeWithTheWithheldList(input.completeness)) {
    return null;
  }
  return refusal(
    "withheldCountsDisagreeWithWithheldList",
    `${withheldTotalOf(input.completeness)} withholdings were counted and ${input.completeness.withheld.length} were named`,
  );
};

const payloadRefusal = (input: DestinationSyncInput): Refusal | null => {
  const unnormalized = storedEventWithoutAPayload(input);
  if (!unnormalized) {
    return null;
  }
  return refusal(
    "unnormalizedLocalEvents",
    `the stored source event ${unnormalized} carries no canonical payload`,
  );
};

const destinationRefusal = (input: DestinationSyncInput): Refusal | null => {
  const wanted = calendarKeyString(input.destination.key);
  if (calendarKeyString(input.destinationListing.scope.calendar) !== wanted) {
    return refusal(
      "destinationListingIsNotThisDestination",
      "the destination listing was read against another calendar",
    );
  }
  const foreign = mirrorOfAnotherDestination(input);
  if (!foreign) {
    return null;
  }
  return refusal(
    "mirrorPointsAtAnotherDestination",
    `a mirror points at ${calendarKeyString(foreign.destinationCalendar)}`,
  );
};

const shapeRefusal = (input: DestinationSyncInput, options: ShadowOptions): Refusal | null => {
  const nonCanonical = nonCanonicalInstantIn(input, options);
  if (nonCanonical) {
    return refusal(
      "nonCanonicalInstant",
      `the instant ${nonCanonical.value} is not canonical UTC`,
    );
  }
  if (compareCanonicalUtcInstants(input.mirrorWindow.start, input.mirrorWindow.end) > 0) {
    return refusal("mirrorWindowInverted", "the mirror window ends before it starts");
  }
  return null;
};

const refusalFor = (input: DestinationSyncInput, options: ShadowOptions): Refusal | null => {
  if (input.mappedSourceCalendars.length === 0) {
    return refusal(
      "noMappedSourceCalendars",
      "the destination has no mapped source calendars to reconcile against",
    );
  }
  if (input.normalization.provider !== input.destination.key.provider) {
    return refusal(
      "normalizedForAnotherProvider",
      `the caller normalized for ${input.normalization.provider}`,
    );
  }
  return (
    witnessRefusal(input) ??
    shapeRefusal(input, options) ??
    destinationRefusal(input) ??
    identityRefusal(input) ??
    membershipRefusal(input) ??
    coverageRefusal(input) ??
    completenessRefusal(input) ??
    payloadRefusal(input)
  );
};

export { refusalFor };
export type { Refusal };
