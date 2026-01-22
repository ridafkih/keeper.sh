"use client"

import { motion, Variants } from "motion/react"
import { ArrowLeft } from "lucide-react"
import { AnimatePresence } from "motion/react"
import { LinkButton } from "@/components/button"
import { formStateAtom, formErrorAtom } from "../atoms/form-state"
import { useAtomValue } from "jotai"

const backButtonVariants: Record<'exit', Variants[string]> = {
  exit: {
    width: 0,
    opacity: 0,
    filter: 'blur(0.125rem)'
  }
}

export const EmailFormBackButton = () => {
  const formState = useAtomValue(formStateAtom)
  const error = useAtomValue(formErrorAtom)

  return (
    <AnimatePresence>
      {(formState === 'idle' || error) && (
        <motion.div
          className="flex flex-col items-end"
          variants={backButtonVariants}
          exit="exit"
          transition={{ width: { duration: 0.24 }, opacity: { duration: 0.12 } }}
        >
          <LinkButton href="/" className="h-full px-3.5 mr-2" variant="border">
            <ArrowLeft size={17} />
          </LinkButton>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
