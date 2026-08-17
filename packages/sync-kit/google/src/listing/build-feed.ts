import type { calendar_v3 } from "@googleapis/calendar";
import type {
  EditableContent,
  InstallationId,
  ListingScope,
  RemoteEvent,
  Provenance,
  RemoteEventFacts,
  Removal,
  WithheldEvent,
  WithholdReason,
} from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";
import { compareCodeUnits } from "../canonical";
import { contentOfPatch, decodeEvent } from "../decode/decode-event";
import type { DecodedItem } from "../decode/decode-event";
import { decodeEventTime } from "../decode/event-time";
import { decodeProvenance } from "../decode/provenance";
import { fingerprintContent } from "../fingerprint";
import { withinGoogleWindow } from "../window/membership";
import { assembleSeries } from "./assemble-series";
import { collapseRevisions, supersededIds } from "./collapse-revisions";

interface FeedInputs {
  readonly items: readonly calendar_v3.Schema$Event[];
  readonly scope: ListingScope;
  readonly installation: InstallationId;
  readonly hash: (input: string) => string;
  readonly mintedIds: ReadonlySet<string>;
}

interface ResolvedFeed {
  readonly events: readonly RemoteEvent[];
  readonly removals: readonly Removal[];
  readonly withheld: readonly WithheldEvent[];
  readonly unnamedDiscards: number;
  readonly selfAuthored: readonly string[];
}

const removalOfCancellation = (
  decoded: Extract<DecodedItem, { kind: "cancelled" }>,
): Removal => {
  if (decoded.uid === null) {
    return { kind: "outOfScope", id: decoded.id };
  }
  return { kind: "cancelled", id: decoded.id, uid: decoded.uid };
};

const withholdReasonOf = (
  decoded: Extract<DecodedItem, { kind: "undecodable" }>,
  superseded: boolean,
): WithholdReason => {
  if (superseded) {
    return "supersededRevisionUnbuildable";
  }
  return decoded.reason;
};

const withheldOf = (
  decoded: Extract<DecodedItem, { kind: "undecodable" }>,
  superseded: boolean,
): WithheldEvent | null => {
  const reason = withholdReasonOf(decoded, superseded);
  if (decoded.uid !== null) {
    return { uid: decoded.uid, id: decoded.id, reason };
  }
  if (decoded.id === null) {
    return null;
  }
  return { uid: null, id: decoded.id, reason };
};

const staysInScope = (scope: ListingScope, content: EditableContent): boolean => {
  const { window: bounds } = scope;
  if (content.recurrence !== null) {
    return true;
  }
  return withinGoogleWindow(bounds, content.time);
};

const withExceptionDates = (
  content: EditableContent,
  lines: readonly string[],
): EditableContent => {
  if (content.recurrence === null || lines.length === 0) {
    return content;
  }
  const merged = new Set([...content.recurrence.exceptions, ...lines]);
  return {
    ...content,
    recurrence: { ...content.recurrence, exceptions: [...merged].toSorted(compareCodeUnits) },
  };
};

const provenanceOf = (item: calendar_v3.Schema$Event, inputs: FeedInputs): Provenance =>
  decodeProvenance(item, {
    installation: inputs.installation,
    deterministicIds: inputs.mintedIds,
  });

const withProvenance = (facts: RemoteEventFacts, provenance: Provenance): RemoteEvent => {
  switch (provenance.kind) {
    case "ours": {
      return { ...facts, provenance };
    }
    case "foreign": {
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

const remoteEventOf = (
  item: calendar_v3.Schema$Event,
  decoded: Extract<DecodedItem, { kind: "patch" }>,
  content: EditableContent,
  inputs: FeedInputs,
): RemoteEvent => {
  const facts: RemoteEventFacts = {
    id: decoded.id,
    deleteHandle: decoded.deleteHandle,
    uid: decoded.fields.uid,
    calendar: inputs.scope.calendar,
    revision: decoded.fields.revision,
    version: decoded.fields.version,
    content,
    fingerprint: fingerprintContent(content, inputs.hash),
  };
  return withProvenance(facts, provenanceOf(item, inputs));
};

const exceptionDatesFor = (
  item: calendar_v3.Schema$Event,
  dates: ReadonlyMap<string, readonly string[]>,
): readonly string[] => {
  if (typeof item.id !== "string") {
    return [];
  }
  return dates.get(item.id) ?? [];
};

const resolveFeed = (inputs: FeedInputs): ResolvedFeed => {
  const collapsed = collapseRevisions(inputs.items);
  const superseded = supersededIds(collapsed);
  const { exceptionDates } = assembleSeries(collapsed.winners);
  const events: RemoteEvent[] = [];
  const removals: Removal[] = [];
  const withheld: WithheldEvent[] = [];
  const selfAuthored: string[] = [];
  const discards = { unnamed: 0 };

  const claimedByUs = (item: calendar_v3.Schema$Event): boolean =>
    provenanceOf(item, inputs).kind === "ours";

  for (const item of collapsed.winners) {
    const decoded = decodeEvent(item, decodeEventTime);
    switch (decoded.kind) {
      case "cancelled": {
        if (claimedByUs(item)) {
          selfAuthored.push(decoded.id.value);
          break;
        }
        removals.push(removalOfCancellation(decoded));
        break;
      }
      case "undecodable": {
        const wasSuperseded = decoded.id !== null && superseded.has(decoded.id.value);
        const entry = withheldOf(decoded, wasSuperseded);
        if (entry === null) {
          discards.unnamed += 1;
          break;
        }
        withheld.push(entry);
        break;
      }
      case "patch": {
        const content = withExceptionDates(
          contentOfPatch(decoded.fields),
          exceptionDatesFor(item, exceptionDates),
        );
        if (!staysInScope(inputs.scope, content)) {
          removals.push({ kind: "outOfScope", id: decoded.id });
          break;
        }
        const event = remoteEventOf(item, decoded, content, inputs);
        events.push(event);
        if (event.provenance.kind === "ours") {
          selfAuthored.push(event.uid.value);
        }
        break;
      }
      default: {
        assertNever(decoded);
      }
    }
  }

  return { events, removals, withheld, unnamedDiscards: discards.unnamed, selfAuthored };
};

export { resolveFeed };
export type { FeedInputs, ResolvedFeed };
