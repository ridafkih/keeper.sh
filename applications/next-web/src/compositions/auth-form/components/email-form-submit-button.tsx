"use client"

import type { FC, PropsWithChildren } from "react"
import { motion, Variants, AnimatePresence } from "motion/react"
import { LoaderCircle } from "lucide-react"
import { Button } from "@/components/button"
import { formStateAtom, FormStateAtomValue } from "../atoms/form-state"
import { useAtomValue } from "jotai"

const submitTextVariants: Record<FormStateAtomValue, Variants[string]> = {
  idle: {
    opacity: 1,
    filter: 'none',
    y: 0,
    scale: 1
  },
  loading: {
    opacity: 0,
    filter: 'blur(0.125rem)',
    y: -2,
    scale: 0.75
  }
}

export const EmailFormSubmitButton: FC<PropsWithChildren> = ({ children }) => {
  const formState = useAtomValue(formStateAtom);

  return (
    <motion.div className="grow">
      <Button disabled={formState === 'loading'} type="submit" className="relative w-full" variant="primary" size="normal">
        <motion.span
          className="origin-top"
          variants={submitTextVariants}
          animate={formState}
          transition={{ duration: 0.16 }}
        >
          {children}
        </motion.span>
        <AnimatePresence>
          {formState === 'loading' && (
            <motion.span
              className="absolute inset-0 m-auto size-fit origin-bottom"
              initial={{ opacity: 0, filter: 'blur(0.125rem)', y: 2, scale: 0.25 }}
              animate={{ opacity: 1, filter: 'none', y: 0, scale: 1 }}
              exit={{ opacity: 0, filter: 'blur(0.125rem)', y: 2, scale: 0.25 }}
              transition={{ duration: 0.16 }}
            >
              <LoaderCircle className="animate-spin" size={17} />
            </motion.span>
          )}
        </AnimatePresence>
      </Button>
    </motion.div>
  )
}
