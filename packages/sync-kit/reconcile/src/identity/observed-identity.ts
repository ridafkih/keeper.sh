import type { RemoteEvent } from "@keeper.sh/sync-protocol";
import { boundsOfTime } from "../state/event-shape";
import type { SourceIdentity } from "./source-identity";

const observedSourceIdentity = (event: RemoteEvent): SourceIdentity | null => {
  if (event.uid.value.length === 0) {
    return null;
  }
  if (event.content.recurrence) {
    return { kind: "master", uid: event.uid };
  }
  const bounds = boundsOfTime(event.content.time);
  return { kind: "slot", uid: event.uid, start: bounds.start, end: bounds.end };
};

export { observedSourceIdentity };
