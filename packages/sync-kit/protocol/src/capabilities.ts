import type { ProviderId } from "./handles";
import type { ObservedPrecondition } from "./precondition";
import type { QuotaScope } from "./provider-failure";

const allDayRepresentations = ["dateOnly", "utcMidnightPair"] as const;
type AllDayRepresentation = (typeof allDayRepresentations)[number];

const recurrenceWriteSupports = ["rfc5545", "providerNative", "expandedOnly", "none"] as const;
type RecurrenceWriteSupport = (typeof recurrenceWriteSupports)[number];

const provenanceChannels = ["extendedProperty", "uidSuffix", "none"] as const;
type ProvenanceChannel = (typeof provenanceChannels)[number];

const deletionAuthorities = ["snapshotAbsence", "explicitRemovalsOnly"] as const;
type DeletionAuthority = (typeof deletionAuthorities)[number];

type DeltaSupport =
  | { readonly kind: "none" }
  | { readonly kind: "tokenized"; readonly windowBoundToCursor: boolean };

interface RepresentableRange {
  readonly minimumSpanSeconds: number;
  readonly zeroDuration: "reject" | "accept";
  readonly invertedRange: "reject" | "clampToStart";
  readonly allDayGrid: "utcDay" | "localDay";
}

interface ThrottleSignal {
  readonly status: number;
  readonly hasRetryAfter: boolean;
}

interface Capabilities<Provider extends ProviderId = ProviderId> {
  readonly provider: Provider;
  readonly delta: DeltaSupport;
  readonly deletionAuthority: DeletionAuthority;
  readonly removalsAreAmbiguous: boolean;
  readonly precondition: ObservedPrecondition["kind"];
  readonly provenanceChannel: ProvenanceChannel;
  readonly quotaScope: QuotaScope;
  readonly throttleSignals: readonly ThrottleSignal[];
  readonly representableRange: RepresentableRange;
  readonly allDay: AllDayRepresentation;
  readonly recurrenceWrite: RecurrenceWriteSupport;
  readonly echoesWrites: boolean;
}

export { allDayRepresentations, deletionAuthorities, provenanceChannels, recurrenceWriteSupports };
export type {
  AllDayRepresentation,
  Capabilities,
  DeletionAuthority,
  DeltaSupport,
  ProvenanceChannel,
  RecurrenceWriteSupport,
  RepresentableRange,
  ThrottleSignal,
};
