import type { FC } from "react";

interface EventMarkerProps {
  color: string;
}

const EventMarker: FC<EventMarkerProps> = ({ color }) => (
  <div className="size-1.25 rounded-xl" style={{ backgroundColor: color }} />
);

export { EventMarker };
