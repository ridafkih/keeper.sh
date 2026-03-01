import { cn } from "@/utils/cn"
import { tv } from "tailwind-variants"
import { Lora } from "next/font/google"
import type { FC, HTMLProps } from "react"

const headingFont = Lora()

const heading = tv({
  base: "tracking-tighter font-medium text-foreground",
  variants: {
    inverted: {
      true: "text-primary-foreground"
    },
    size: {
      "3xl": "text-3xl",
      "2xl": "text-2xl",
      xl: "text-xl",
    }
  }
})

type HeadingProps = HTMLProps<HTMLHeadingElement> & {
  inverted?: boolean
}

export const Heading1: FC<HeadingProps> = ({ className, children, inverted, ...props }) => {
  return (
    <h1 {...props} className={cn(headingFont.className, heading({ size: "3xl", inverted }), className)}>{children}</h1>
  )
}

export const Heading2: FC<HeadingProps> = ({ className, children, inverted, ...props }) => {
  return (
    <h2 {...props} className={cn(headingFont.className, heading({ size: "2xl", inverted }), className)}>{children}</h2>
  )
}

export const Heading3: FC<HeadingProps> = ({ className, children, inverted, ...props }) => {
  return (
    <h3 {...props} className={cn(headingFont.className, heading({ size: "xl", inverted }), className)}>{children}</h3>
  )
}

export const Heading4: FC<HeadingProps> = ({ className, children, inverted, ...props }) => {
  return (
    <h4 {...props} className={cn(headingFont.className, heading({ size: "md", inverted }), className)}>{children}</h4>
  )
}
