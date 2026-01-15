import type { FC, PropsWithChildren } from "react";

const CalendarFrame: FC<PropsWithChildren> = ({ children }) => (
  <div className="p-0.5 bg-surface-skeleton">{children}</div>
);

export { CalendarFrame };
