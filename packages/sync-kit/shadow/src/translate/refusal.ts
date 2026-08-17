const translationRefusals = [
  "noMappedSourceCalendars",
  "sourceCalendarSetChangedDuringRead",
  "unnormalizedLocalEvents",
  "normalizedForAnotherProvider",
  "nonCanonicalInstant",
  "mirrorWindowInverted",
  "destinationListingIsNotThisDestination",
  "mirrorPointsAtAnotherDestination",
  "duplicateSourceIdentityClaim",
  "storedCoverageMissingForMappedSource",
  "withheldCountsDisagreeWithWithheldList",
  "rowOnAnUnmappedSourceCalendar",
] as const;
type TranslationRefusal = (typeof translationRefusals)[number];

export { translationRefusals };
export type { TranslationRefusal };
