import type { FC, PropsWithChildren } from "react"
import { FlexColumnGroup } from "@/components/flex-column-group"

const DashboardLayout: FC<PropsWithChildren> = ({ children }) => {
  return (
    <main className="flex size-full justify-center items-center min-h-screen">
      <div className="w-full max-w-sm px-1.5">
        <FlexColumnGroup className="gap-2 h-full">
          {children}
        </FlexColumnGroup>
      </div>
    </main>
  )
}

export default DashboardLayout
