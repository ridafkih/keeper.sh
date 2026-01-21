"use client"

import type { FC, PropsWithChildren } from "react"
import { motion, Variants } from "motion/react"
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

const loaderVariants: Record<FormStateAtomValue, Variants[string]> = {
  idle: {
    opacity: 0,
    filter: 'blur(0.125rem)',
    y: 2,
    scale: 0.75
  },
  loading: {
    opacity: 1,
    filter: 'none',
    y: 0,
    scale: 1
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
        <motion.span
          className="absolute inset-0 m-auto size-fit origin-bottom"
          variants={loaderVariants}
          initial="idle"
          animate={formState}
          transition={{ delay: 0.08, duration: 0.16 }}
        >
          <LoaderCircle className="animate-spin" size={17} />
        </motion.span>
      </Button>
    </motion.div>
  )
}
