import type { FC, PropsWithChildren } from "react"
import { FlexColumnGroup } from "@/components/flex-column-group"

export const HeroSection: FC<PropsWithChildren> = ({ children }) => {
  return (
    <FlexColumnGroup className="gap-2 items-center">
      {children}
    </FlexColumnGroup>
  )
}
