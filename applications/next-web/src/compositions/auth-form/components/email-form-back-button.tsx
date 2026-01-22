"use client"

import { motion, Variants } from "motion/react"
import { ArrowLeft } from "lucide-react"
import { AnimatePresence } from "motion/react"
import { LinkButton } from "@/components/button"
import { formStateAtom, formErrorAtom } from "../atoms/form-state"
import { useAtomValue } from "jotai"

const backButtonVariants: Variants = {
  hidden: {
    width: 0,
    opacity: 0,
    filter: 'blur(0.125rem)'
  },
  visible: {
    width: 'auto',
    opacity: 1,
    filter: 'blur(0px)'
  }
}

export const EmailFormBackButton = () => {
  const formState = useAtomValue(formStateAtom)

  return (
    <AnimatePresence initial={false}>
      {formState !== 'loading' && (
        <motion.div
          className="flex flex-col items-end"
          variants={backButtonVariants}
          initial="hidden"
          animate="visible"
          exit="hidden"
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
