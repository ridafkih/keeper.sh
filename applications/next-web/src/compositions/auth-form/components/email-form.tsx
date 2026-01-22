"use client"

import type { FC, FormEvent } from "react"
import { LayoutGroup } from "motion/react"
import { FlexRowGroup } from "@/components/flex-row-group"
import { formStateAtom, formErrorAtom } from "../atoms/form-state"
import { useSetAtom } from "jotai"
import { EmailFormBackButton } from "./email-form-back-button"
import { EmailFormSubmitButton } from "./email-form-submit-button"
import { EmailFormInput } from "./email-form-input"
import { EmailFormError } from "./email-form-error"

type EmailFormProps = {
  submitButtonText: string
}

export const EmailForm: FC<EmailFormProps> = ({ submitButtonText }) => {
  const setFormState = useSetAtom(formStateAtom)
  const setFormError = useSetAtom(formErrorAtom)

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    setFormState("loading")

    // Simulate authentication error for testing
    setTimeout(() => {
      setFormState("idle")
      setFormError("Invalid email or password. Please try again.")
    }, 1500)
  }

  return (
    <form onSubmit={handleSubmit} className="contents">
      <EmailFormError />
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
