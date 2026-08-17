import type { Capabilities } from "@keeper.sh/sync-protocol";

const microsoftCapabilities = {
  provider: "microsoft",
  delta: { kind: "tokenized", windowBoundToCursor: true },
  deletionAuthority: "snapshotAbsence",
  removalsAreAmbiguous: false,
  precondition: "matchesVersion",
  provenanceChannel: "extendedProperty",
  quotaScope: "perMailbox",
  throttleSignals: [
    { status: 429, hasRetryAfter: true },
    { status: 503, hasRetryAfter: true },
  ],
  representableRange: {
    minimumSpanSeconds: 0,
    zeroDuration: "accept",
    invertedRange: "clampToStart",
    allDayGrid: "utcDay",
  },
  allDay: "utcMidnightPair",
  recurrenceWrite: "providerNative",
  echoesWrites: true,
} as const satisfies Capabilities<"microsoft">;

export { microsoftCapabilities };
