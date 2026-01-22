"use client"

import { Copy } from "@/components/copy"
import { formErrorAtom } from "../atoms/form-state"
import { useAtomValue } from "jotai"
import { AlertCircle } from "lucide-react"
import type { FC } from "react"

export const EmailFormError: FC = () => {
  const error = useAtomValue(formErrorAtom)

  if (!error) return null

  return (
    <div className="border border-border rounded-xl px-4 py-2.5 bg-surface flex items-center gap-2">
      <AlertCircle size={16} className="text-foreground-secondary flex-shrink-0" />
      <Copy className="text-foreground-secondary">{error}</Copy>
    </div>
  )
}
