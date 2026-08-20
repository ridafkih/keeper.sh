export { defaultIcsLimits, selfAuthoredPolicies } from "./options";
export type { IcsLimits, IcsOptions, SelfAuthoredPolicy } from "./options";

export { IcsInternalDataError } from "./errors";

export { stripByteOrderMark } from "./text/byte-order-mark";
export { foldContentLine, unfoldContentLines } from "./text/fold";
export { formatPropertyLine, parsePropertyLine } from "./text/property-line";
export type { PropertyLine } from "./text/property-line";
export { walkComponents } from "./text/component-walk";
export type { ComponentWalk, WalkedProperty } from "./text/component-walk";
export { applyIcsPatches, unreadableReasons } from "./text/patch";
export type { IcsPatch, IcsPatchCoercion, PatchOutcome, UnreadableReason } from "./text/patch";
export { defaultIcsPatches } from "./text/patches/index";
export { coerceCompliantDate } from "./text/patches/coerce-compliant-date";
export { splitMixedExdate } from "./text/patches/split-mixed-exdate";

export { windowsZones } from "./zone/windows-zones";
export type { WindowsZoneName } from "./zone/windows-zones";
export { normalizeZoneIdentifier } from "./zone/normalize-zone-id";
export { createZoneCache, zoneCacheStatistics } from "./zone/zone-cache";
export type { ZoneCache, ZoneCacheStatistics } from "./zone/zone-cache";
export { formatUtcOffset, zoneOffsetMinutes } from "./zone/offset";
export { instantToWallTime, resolveWallTime } from "./zone/wall-time";
export type { WallTime, WallTimeResolution } from "./zone/wall-time";
export { findZoneTransitions } from "./zone/transitions";
export { readDeclaredZones } from "./zone/vtimezone";
export type { DeclaredZone } from "./zone/vtimezone";
export { isIanaAuthoritative } from "./zone/authority";
export { resolveZoneIdentifier, zoneRefusals, zoneResolutionRungs } from "./zone/resolve-zone-identifier";
export type { ZoneRefusal, ZoneResolution, ZoneResolutionRung } from "./zone/resolve-zone-identifier";
export { buildVtimezone } from "./zone/build-vtimezone";
export type { VtimezoneBlock } from "./zone/build-vtimezone";
export { synthesizeMissingVtimezones } from "./zone/synthesize-vtimezones";

export { parseIcsDocument } from "./parse/parse-calendar";
export type { IcsDocument, VeventComponent } from "./parse/parse-calendar";
export { eventIdentityKey } from "./parse/identity";
export type { EventIdentity } from "./parse/identity";
export { parseVevent } from "./parse/parse-vevent";
export type { EventRevision, ParsedVevent, VeventOutcome } from "./parse/parse-vevent";
export { compareEventRevisions } from "./parse/revision-order";
export { parseIcsDuration } from "./parse/duration";
export { resolveEndTime } from "./parse/end-time";
export type { EndTimeResolution } from "./parse/end-time";
export { anchorFloatingValue, floatingAnchorSources } from "./parse/floating";
export type { FloatingAnchor, FloatingAnchorSource } from "./parse/floating";
export { applyCancellations } from "./parse/cancellation";
export type { CancellationResolution } from "./parse/cancellation";
export {
  detectEventLevelRecurrenceDates,
  detectRecurrenceRangeOverrides,
} from "./parse/recurrence-support";
export { isSelfAuthored } from "./parse/self-authored";
export { toListingDiagnostics } from "./parse/diagnostics";

export { canonicalFieldOrder } from "./canonical/canonical-event";
export type { CanonicalEvent } from "./canonical/canonical-event";
export { reanchorRecurrenceIdentities, resolveIsAllDay } from "./canonical/all-day";
export type { RecurrenceIdentitySet } from "./canonical/all-day";
export { toPlainTextDescription } from "./canonical/plain-text";
export { canonicalizeRecurrenceRule, utcUntilAnchor } from "./canonical/recurrence-rule";
export type { UntilAnchor } from "./canonical/recurrence-rule";
export { withinTimeWindow } from "./canonical/window";
export { projectCanonicalEvent } from "./canonical/project";
export { encodeCanonicalEvent } from "./canonical/encode";
export { canonicalEventFingerprint } from "./canonical/hash";
export { feedContentHash } from "./canonical/feed-hash";
export { parseStoredCanonicalEvent } from "./canonical/stored-event";

export { presentIdentities, usableIdentities } from "./listing/presence";
export { coverageForWholeFeed, feedFreshnesses, projectIcsFeed } from "./listing/project-feed";
export type {
  FeedFreshness,
  IcsFeedProjection,
  IcsFeedRequest,
  UnsupportedEvent,
} from "./listing/project-feed";

export { escapeTextValue, quoteParameterValue } from "./serialise/escape";
export { serialiseZonedDate } from "./serialise/zoned-date";
export type { ZonedDateRendering } from "./serialise/zoned-date";
export { serialiseCalendarResource } from "./serialise/serialise-resource";
export type { RecurrenceSet, SerialisedResource } from "./serialise/serialise-resource";
