import type { PropsWithChildren } from "react";

export function Layout({ children }: PropsWithChildren) {
  return (
    <div className="grid grid-cols-[minmax(1rem,1fr)_minmax(auto,48rem)_minmax(1rem,1fr)] auto-rows-min size-full">
      {children}
    </div>
  )
}

export function LayoutItem({ children }: PropsWithChildren) {
  return (
    <div className="contents *:col-[2_/_span_1]">{children}</div>
  )
}
