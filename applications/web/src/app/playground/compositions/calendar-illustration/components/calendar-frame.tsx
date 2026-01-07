import { FC, ReactNode } from "react";

type CalendarFrameProps = {
  children: ReactNode;
};

export const CalendarFrame: FC<CalendarFrameProps> = ({ children }) => (
  <div className="p-0.5 bg-neutral-200">{children}</div>
);
