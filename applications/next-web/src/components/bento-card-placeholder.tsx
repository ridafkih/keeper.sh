import { MicroCopy } from "@/components/micro-copy"
import type { FC } from "react"

export const BentoCardPlaceholder: FC = () => {
  return (
    <div className="bg-surface flex items-center justify-center p-12">
      <MicroCopy className="text-foreground-subtle">Illustration</MicroCopy>
    </div>
  )
}
