import type { Capabilities } from "@keeper.sh/sync-protocol";

const caldavCapabilities = {
  provider: "caldav",
  delta: { kind: "tokenized", windowBoundToCursor: false },
  deletionAuthority: "snapshotAbsence",
  removalsAreAmbiguous: false,
  precondition: "matchesVersion",
  provenanceChannel: "uidSuffix",
  quotaScope: "perCollection",
  throttleSignals: [
    { status: 429, hasRetryAfter: true },
    { status: 503, hasRetryAfter: true },
  ],
  representableRange: {
    minimumSpanSeconds: 1,
    zeroDuration: "reject",
    invertedRange: "reject",
    allDayGrid: "utcDay",
  },
  allDay: "dateOnly",
  recurrenceWrite: "rfc5545",
  echoesWrites: false,
} as const satisfies Capabilities<"caldav">;

export { caldavCapabilities };
