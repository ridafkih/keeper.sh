"use client"

import { Input } from "@/components/input"
import { formStateAtom, formErrorAtom } from "../atoms/form-state"
import { useAtomValue, useSetAtom } from "jotai"
import { cn } from "@/utils/cn"

export const EmailFormInput = () => {
  const formState = useAtomValue(formStateAtom)
  const error = useAtomValue(formErrorAtom)
  const setError = useSetAtom(formErrorAtom)

  const handleChange = () => {
    if (error) {
      setError(null)
    }
  }

  return (
    <Input
      disabled={formState === 'loading'}
      type="email"
      placeholder="johndoe+keeper@example.com"
      className={cn(error && "border-red-500 dark:border-red-400")}
      onChange={handleChange}
    />
  )
}
