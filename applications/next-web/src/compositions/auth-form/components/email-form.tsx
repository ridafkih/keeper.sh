"use client"

import type { FC, FormEvent } from "react"
import { LayoutGroup } from "motion/react"
import { FlexRowGroup } from "@/components/flex-row-group"
import { formStateAtom } from "../atoms/form-state"
import { useSetAtom } from "jotai"
import { EmailFormBackButton } from "./email-form-back-button"
import { EmailFormSubmitButton } from "./email-form-submit-button"
import { EmailFormInput } from "./email-form-input"

type EmailFormProps = {
  submitButtonText: string
}

export const EmailForm: FC<EmailFormProps> = ({ submitButtonText }) => {
  const setFormState = useSetAtom(formStateAtom)

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    setFormState("loading");
  }

  return (
    <form onSubmit={handleSubmit} className="contents">
      <EmailFormInput />
      <FlexRowGroup className="items-stretch">
        <LayoutGroup>
          <EmailFormBackButton />
          <EmailFormSubmitButton>{submitButtonText}</EmailFormSubmitButton>
        </LayoutGroup>
      </FlexRowGroup>
    </form>
  )
}
