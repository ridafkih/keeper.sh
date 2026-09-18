import type { TimeWindow } from "@keeper.sh/sync-protocol";

const sameTimeWindow = (left: TimeWindow, right: TimeWindow): boolean =>
  left.start.value === right.start.value && left.end.value === right.end.value;

export { sameTimeWindow };
