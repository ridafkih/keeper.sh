import type { FC, PropsWithChildren } from "react";

const CalendarFrame: FC<PropsWithChildren> = ({ children }) => (
  <div className="p-0.5 bg-neutral-200">{children}</div>
);

export { CalendarFrame };
