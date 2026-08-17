import type { IcsOptions } from "@keeper.sh/sync-ical";
import type {
  ListingScope,
  RemoteEvent,
  Removal,
  Result,
  WithheldEvent,
} from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";
import type { ReportedResource } from "../report/sync-report";
import { projectResource, unreadableWithheld } from "./project-resource";

interface FeedRequest {
  readonly resources: readonly ReportedResource[];
  readonly scope: ListingScope;
  readonly options: IcsOptions;
  readonly hash: (input: string) => string;
}

interface CalDAVFeed {
  readonly events: readonly RemoteEvent[];
  readonly removals: readonly Removal[];
  readonly withheld: readonly WithheldEvent[];
  readonly selfAuthored: readonly string[];
  readonly readCount: number;
  readonly unreadableCount: number;
}

const byPath = (left: ReportedResource, right: ReportedResource): number =>
  left.path.localeCompare(right.path);

const outrankedBy = (candidate: RemoteEvent, holder: RemoteEvent): boolean => {
  if (candidate.revision !== holder.revision) {
    return candidate.revision > holder.revision;
  }
  return candidate.id.value < holder.id.value;
};

const supersededWithheld = (event: RemoteEvent): WithheldEvent => ({
  uid: event.uid,
  id: event.id,
  reason: "supersededRevisionUnbuildable",
});

interface UidCollapse {
  readonly winners: readonly RemoteEvent[];
  readonly losers: readonly RemoteEvent[];
}

const oneEventPerUid = (events: readonly RemoteEvent[]): UidCollapse => {
  const held = new Map<string, RemoteEvent>();
  const losers: RemoteEvent[] = [];
  for (const event of events) {
    const holder = held.get(event.uid.value);
    if (!holder) {
      held.set(event.uid.value, event);
      continue;
    }
    if (outrankedBy(event, holder)) {
      held.set(event.uid.value, event);
      losers.push(holder);
      continue;
    }
    losers.push(event);
  }
  return { winners: [...held.values()], losers };
};

const buildCalDAVFeed = (request: FeedRequest): Result<CalDAVFeed> => {
  const events: RemoteEvent[] = [];
  const removals: Removal[] = [];
  const withheld: WithheldEvent[] = [];
  const selfAuthored: string[] = [];
  const counts = { readCount: 0, unreadableCount: 0 };
  for (const resource of [...request.resources].toSorted(byPath)) {
    const projected = projectResource(resource, request.scope, request.options, request.hash);
    switch (projected.kind) {
      case "event": {
        counts.readCount += 1;
        events.push(projected.event);
        removals.push(...projected.removals);
        withheld.push(...projected.withheld);
        selfAuthored.push(...projected.selfAuthored);
        break;
      }
      case "withheld": {
        counts.readCount += 1;
        removals.push(...projected.removals);
        withheld.push(...projected.withheld);
        selfAuthored.push(...projected.selfAuthored);
        break;
      }
      case "unreadable": {
        counts.unreadableCount += 1;
        withheld.push(unreadableWithheld(resource.path, projected.reason));
        break;
      }
      default: {
        return assertNever(projected);
      }
    }
  }
  const collapsed = oneEventPerUid(events);
  return {
    ok: true,
    value: {
      events: collapsed.winners,
      removals,
      withheld: [...withheld, ...collapsed.losers.map((event) => supersededWithheld(event))],
      selfAuthored,
      readCount: counts.readCount,
      unreadableCount: counts.unreadableCount,
    },
  };
};

export { buildCalDAVFeed };
export type { CalDAVFeed, FeedRequest };
