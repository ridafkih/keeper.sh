import type { IcsOptions } from "@keeper.sh/sync-ical";
import { projectIcsFeed } from "@keeper.sh/sync-ical";
import type {
  ListingScope,
  RemoteEvent,
  Removal,
  WithheldEvent,
  WithholdReason,
} from "@keeper.sh/sync-protocol";
import { caldavFingerprint } from "../fingerprint";
import { constraintViolatedBy, shapedContent } from "../write/normalize";
import { namesItsOwnUid } from "../write/resource-url";
import type { ReportedResource } from "../report/sync-report";

type ResourceProjection =
  | {
      readonly kind: "event";
      readonly event: RemoteEvent;
      readonly removals: readonly Removal[];
      readonly withheld: readonly WithheldEvent[];
      readonly selfAuthored: readonly string[];
    }
  | {
      readonly kind: "withheld";
      readonly removals: readonly Removal[];
      readonly withheld: readonly WithheldEvent[];
      readonly selfAuthored: readonly string[];
    }
  | { readonly kind: "unreadable"; readonly reason: WithholdReason };

const identifiedAt = (event: RemoteEvent, path: string, etag: string | null, hash: (input: string) => string): RemoteEvent => {
  const content = shapedContent(event.content);
  return {
    ...event,
    id: { kind: "remoteEventId", value: path },
    deleteHandle: { kind: "deleteHandle", value: path },
    version: { kind: "remoteVersion", value: etag ?? "" },
    content,
    fingerprint: caldavFingerprint(content, hash),
  };
};

const sequenceOf = (event: RemoteEvent): number => event.revision;

const preferred = (left: RemoteEvent, right: RemoteEvent): RemoteEvent => {
  if (sequenceOf(left) !== sequenceOf(right)) {
    if (sequenceOf(left) > sequenceOf(right)) {
      return left;
    }
    return right;
  }
  if (left.uid.value <= right.uid.value) {
    return left;
  }
  return right;
};

const collapsedToOneUid = (
  events: readonly RemoteEvent[],
): { readonly winner: RemoteEvent | null; readonly losers: readonly RemoteEvent[] } => {
  const [first, ...rest] = events;
  if (!first) {
    return { winner: null, losers: [] };
  }
  const chosen = { winner: first };
  for (const candidate of rest) {
    chosen.winner = preferred(chosen.winner, candidate);
  }
  return {
    winner: chosen.winner,
    losers: events.filter((event) => event !== chosen.winner),
  };
};

const withheldFor = (event: RemoteEvent): WithheldEvent => ({
  uid: event.uid,
  id: event.id,
  reason: "supersededRevisionUnbuildable",
});

const unreadableWithheld = (path: string, reason: WithholdReason): WithheldEvent => ({
  uid: null,
  id: { kind: "remoteEventId", value: path },
  reason,
});

const selfAuthoredIdentifiers = (withheld: readonly WithheldEvent[]): readonly string[] =>
  withheld
    .filter((entry) => entry.reason === "selfAuthored")
    .map((entry) => entry.uid?.value ?? entry.id?.value ?? "");

const echoedBack = (event: RemoteEvent, path: string): boolean => {
  if (event.provenance.kind !== "ours") {
    return false;
  }
  return !namesItsOwnUid(path, event.uid);
};

const ourOwn = (events: readonly RemoteEvent[]): readonly RemoteEvent[] =>
  events.filter((event) => event.provenance.kind === "ours");

const selfAuthoredWithheld = (event: RemoteEvent): WithheldEvent => ({
  uid: event.uid,
  id: event.id,
  reason: "selfAuthored",
});

const unrepresentableWithheld = (event: RemoteEvent): WithheldEvent => ({
  uid: event.uid,
  id: event.id,
  reason: "unrepresentableTime",
});

const cancelledAt = (removal: Removal, path: string): Removal => {
  if (removal.kind === "outOfScope") {
    return { kind: "outOfScope", id: { kind: "remoteEventId", value: path } };
  }
  return { kind: removal.kind, id: { kind: "remoteEventId", value: path }, uid: removal.uid };
};

const projectResource = (
  resource: ReportedResource,
  scope: ListingScope,
  options: IcsOptions,
  hash: (input: string) => string,
): ResourceProjection => {
  const body = resource.calendarData ?? "";
  if (body.trim().length === 0) {
    return { kind: "unreadable", reason: "unparseable" };
  }
  const projected = projectIcsFeed({
    body,
    scope,
    previousContentHash: null,
    options,
  });
  if (!projected.ok) {
    return { kind: "unreadable", reason: "unparseable" };
  }
  const { listing } = projected.value;
  const projectedEvents = listing.events.map((event) =>
    identifiedAt(event, resource.path, resource.etag, hash),
  );
  const echoed = projectedEvents.filter((event) => echoedBack(event, resource.path));
  const carried = projectedEvents.filter((event) => !echoedBack(event, resource.path));
  const degenerate = carried.filter((event) => constraintViolatedBy(event.content) !== null);
  const identified = carried.filter((event) => constraintViolatedBy(event.content) === null);
  const collapsed = collapsedToOneUid(identified);
  const withheld = [
    ...listing.withheld,
    ...echoed.map((event) => selfAuthoredWithheld(event)),
    ...degenerate.map((event) => unrepresentableWithheld(event)),
    ...collapsed.losers.map((event) => withheldFor(event)),
  ];
  const selfAuthored = [
    ...selfAuthoredIdentifiers(listing.withheld),
    ...echoed.map((event) => event.uid.value),
    ...ourOwn(identified).map((event) => event.uid.value),
  ];
  const removals = listing.removals.map((removal) => cancelledAt(removal, resource.path));
  if (!collapsed.winner) {
    return { kind: "withheld", removals, withheld, selfAuthored };
  }
  return { kind: "event", event: collapsed.winner, removals, withheld, selfAuthored };
};

export { projectResource, unreadableWithheld };
export type { ResourceProjection };
