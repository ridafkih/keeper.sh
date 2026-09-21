/** How long after a trackpad-like wheel event the ones that follow still belong to its gesture. */
export const TRACKPAD_GESTURE_MS = 200;

interface WheelShape {
  deltaY: number;
  deltaMode: number;
  ctrlKey: boolean;
  wheelDeltaY?: number;
}

/** Rows a notched wheel asks to page, or 0 when the event should scroll natively (trackpad, pinch, sideways). */
export function resolveWheelNotches(event: WheelShape, inTrackpadGesture: boolean): number {
  if (event.ctrlKey || event.deltaY === 0) return 0;
  if (event.deltaMode !== 0) return Math.sign(event.deltaY);
  const wheelDeltaY = event.wheelDeltaY ?? 0;
  // A notched wheel reports whole 120s on every platform; a trackpad only lands on one by chance, mid-gesture.
  if (inTrackpadGesture || wheelDeltaY === 0 || wheelDeltaY % 120 !== 0) return 0;
  return -wheelDeltaY / 120;
}
