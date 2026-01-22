"use client"

import type { FC, PropsWithChildren } from "react"
import { useSetAtom } from "jotai"
import { LinkButton } from "@/components/button"
import { calendarHoverAtom } from "../state/calendar-hover"

type CalendarIllustrationButtonProps = PropsWithChildren<{
  href: string
}>

export const CalendarIllustrationButton: FC<CalendarIllustrationButtonProps> = ({ href, children }) => {
  const setIsHovered = useSetAtom(calendarHoverAtom)

  return (
    <LinkButton
      href={href}
      variant="primary"
      size="compact"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {children}
    </LinkButton>
  )
}
