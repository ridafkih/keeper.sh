"use client"

import { Star } from "lucide-react"
import { useState, useEffect, useRef } from "react"
import { AnimatePresence, motion } from "motion/react"
import Link from "next/link"
import { cn } from "@/utils/cn"
import { tv } from "tailwind-variants"

const button = tv({
  base: `
    flex gap-1.5 items-center justify-center rounded-xl w-fit text-sm font-medium text-nowrap select-none
    tracking-tighter border border-transparent shadow-xs
    hover:enabled:cursor-pointer
    focus-visible:outline-2 outline-offset-1 outline-border-emphasis
  `,
  variants: {
    variant: {
      ghost: "text-foreground hover:backdrop-brightness-95 active:backdrop-brightness-90 disabled:backdrop-brightness-90 dark:hover:backdrop-brightness-150 dark:active:backdrop-brightness-175 dark:disabled:backdrop-brightness-175 shadow-none"
    },
    size: {
      compact: "px-3 py-1.5"
    },
  }
})

export const GithubStarButton = () => {
  const [showStarButton, setShowStarButton] = useState(true)

  useEffect(() => {
    setShowStarButton(window.scrollY <= 32)

    const handleScroll = () => {
      setShowStarButton(window.scrollY <= 32)
    }

    window.addEventListener("scroll", handleScroll)
    return () => window.removeEventListener("scroll", handleScroll)
  }, [setShowStarButton])

  return (
    <AnimatePresence>
      {showStarButton && (
        <motion.a
          href="https://github.com"
          className={cn(button({ variant: "ghost", size: "compact" }))}
          initial={{ opacity: 0, x: 10, filter: "blur(4px)" }}
          animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, x: 10, filter: "blur(4px)" }}
          transition={{ duration: 0.2 }}
        >
          <Star size={14} />
          <span>367</span>
        </motion.a>
      )}
    </AnimatePresence>
  )
}
