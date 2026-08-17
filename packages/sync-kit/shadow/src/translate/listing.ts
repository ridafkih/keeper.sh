import type {
  CalendarKey,
  ChangeListing,
  ListingDiagnostics,
  ListingScope,
  Provenance,
  RemoteEvent,
  RemoteEventFacts,
  TimeWindow,
  WithheldEvent,
} from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";
import type { LocalReadCompleteness } from "../input/read-completeness";
import { readIsComplete, withheldFromSource } from "../input/read-completeness";
import type { SourceCoverageProof } from "../input/stored-coverage";
import type { StoredSourceEvent } from "../input/destination-sync-input";
import type { DecodeStoredEvent } from "./decode";

type SynthesizedSourceListing = Extract<ChangeListing, { kind: "partial" } | { kind: "snapshot" }>;

interface SourceListingRequest {
  readonly sourceCalendar: CalendarKey;
  readonly mirrorWindow: TimeWindow;
  readonly storedSourceEvents: readonly StoredSourceEvent[];
  readonly completeness: LocalReadCompleteness;
  readonly proof: SourceCoverageProof;
  readonly decodeStored: DecodeStoredEvent;
}

const storedStateContinuation = "storedSourceState";

const scopeOf = (request: SourceListingRequest): ListingScope => ({
  calendar: request.sourceCalendar,
  window: request.mirrorWindow,
  expandRecurrences: false,
});

const asStamped = (facts: RemoteEventFacts, provenance: Provenance): RemoteEvent => {
  switch (provenance.kind) {
    case "foreign": {
      return { ...facts, provenance };
    }
    case "ours": {
      return { ...facts, provenance };
    }
    case "indeterminate": {
      return { ...facts, provenance };
    }
    default: {
      return assertNever(provenance);
    }
  }
};

const storedRemoteEvents = (request: SourceListingRequest): readonly RemoteEvent[] =>
  request.storedSourceEvents.flatMap((stored): readonly RemoteEvent[] => {
    const decoded = request.decodeStored(stored.canonical);
    if (decoded.kind === "corrupt") {
      return [];
    }
    return [
      asStamped(
        {
          id: stored.id,
          deleteHandle: stored.deleteHandle,
          uid: stored.uid,
          calendar: request.sourceCalendar,
          revision: stored.revision,
          version: stored.version,
          content: decoded.canonical.content,
          fingerprint: stored.fingerprint,
        },
        stored.provenance,
      ),
    ];
  });

const diagnosticsOf = (withheld: readonly WithheldEvent[]): ListingDiagnostics => ({
  withheld: { sample: [], total: withheld.length },
  selfAuthored: { sample: [], total: 0 },
  unrepresentable: { sample: [], total: 0 },
  pagesFetched: 0,
});

const synthesizeSourceListing = (request: SourceListingRequest): SynthesizedSourceListing => {
  const scope = scopeOf(request);
  const events = storedRemoteEvents(request);
  const withheld = withheldFromSource(request.completeness, request.sourceCalendar);
  const diagnostics = diagnosticsOf(withheld);
  const { proof } = request;
  if (proof.kind === "unproven" || !readIsComplete(request.completeness)) {
    return {
      kind: "partial",
      scope,
      events,
      withheld,
      continuation: { kind: "continuation", value: storedStateContinuation, scope },
      diagnostics,
    };
  }
  return {
    kind: "snapshot",
    scope,
    coverage: { covered: proof.covered, calendar: request.sourceCalendar },
    events,
    removals: [],
    withheld,
    cursor: null,
    diagnostics,
  };
};

export { synthesizeSourceListing };
export type { SourceListingRequest, SynthesizedSourceListing };
