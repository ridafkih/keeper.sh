"use client"

import { Input } from "@/components/input"
import { formStateAtom } from "../atoms/form-state"
import { useAtomValue } from "jotai"

export const EmailFormInput = () => {
  const formState = useAtomValue(formStateAtom);

  return (
    <Input disabled={formState === 'loading'} type="email" placeholder="johndoe+keeper@example.com" />
  )
}
