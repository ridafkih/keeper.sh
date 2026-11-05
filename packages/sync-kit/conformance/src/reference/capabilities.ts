import type { Capabilities } from "@keeper.sh/sync-protocol";

const referenceMinimumSpanSeconds = 900;

const referenceCapabilities: Capabilities<"reference"> = {
  provider: "reference",
  delta: { kind: "tokenized", windowBoundToCursor: true },
  deletionAuthority: "snapshotAbsence",
  removalsAreAmbiguous: false,
  precondition: "matchesVersion",
  provenanceChannel: "extendedProperty",
  quotaScope: "perUser",
  throttleSignals: [
    { status: 429, hasRetryAfter: true },
    { status: 503, hasRetryAfter: false },
  ],
  representableRange: {
    minimumSpanSeconds: referenceMinimumSpanSeconds,
    zeroDuration: "accept",
    invertedRange: "reject",
    allDayGrid: "utcDay",
  },
  allDay: "dateOnly",
  recurrenceWrite: "rfc5545",
  echoesWrites: true,
};

export { referenceCapabilities, referenceMinimumSpanSeconds };
