import { FC } from "react";

type EventMarkerProps = {
  color: string;
};

export const EventMarker: FC<EventMarkerProps> = ({ color }) => (
  <div className="size-1.25 rounded-full" style={{ backgroundColor: color }} />
);
