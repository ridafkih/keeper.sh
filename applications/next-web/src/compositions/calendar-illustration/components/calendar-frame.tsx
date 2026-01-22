import type { FC, PropsWithChildren } from "react"

export const CalendarFrame: FC<PropsWithChildren> = ({ children }) => {
  return <div className="p-0.5 bg-border">{children}</div>
}
