import { tv } from "tailwind-variants"
import Link from "next/link"
import { cn } from "@/utils/cn"
import type { ButtonHTMLAttributes, ComponentProps, DetailedHTMLProps, FC } from "react"

const button = tv({
  base: `
    flex gap-1.5 items-center justify-center rounded-xl w-fit font-medium text-nowrap select-none
    tracking-tighter border border-transparent shadow-xs
    hover:enabled:cursor-pointer
    focus-visible:outline-2 outline-offset-1 outline-border-emphasis
  `,
  variants: {
    variant: {
      primary: "bg-primary text-primary-foreground hover:brightness-90 disabled:brightness-80 active:brightness-80 dark:hover:brightness-80 dark:active:brightness-70 dark:disabled:brightness-70",
      secondary: "text-foreground backdrop-brightness-95 hover:backdrop-brightness-90 active:backdrop-brightness-85 disabled:backdrop-brightness-85 dark:backdrop-brightness-105 dark:hover:backdrop-brightness-150 dark:active:backdrop-brightness-175 disabled:dark:backdrop-brightness-175 shadow-none",
      border: "border-border text-foreground bg-background hover:brightness-95 active:brightness-90 disabled:brightness-90 dark:hover:brightness-110 dark:active:brightness-120 dark:disabled:brightness-120",
      ghost: "text-foreground hover:backdrop-brightness-95 active:backdrop-brightness-90 disabled:backdrop-brightness-90 dark:hover:backdrop-brightness-150 dark:active:backdrop-brightness-175 dark:disabled:backdrop-brightness-175 shadow-none"
    },
    size: {
      normal: "px-4 py-2.5",
      compact: "px-3 py-1.5 text-sm"
    },
  },
  defaultVariants: {
    size: "normal",
    variant: "primary",
  }
})

type WithButtonProps<ComponentProperties> = ComponentProperties & {
  variant?: keyof typeof button["variants"]["variant"];
  size?: keyof typeof button["variants"]["size"];
}

export const Button: FC<WithButtonProps<DetailedHTMLProps<ButtonHTMLAttributes<HTMLButtonElement>, HTMLButtonElement>>> = ({ className, variant, size, ...props }) => {
  return (
    <button {...props} className={cn(button({ variant, size }), className)}></button>
  )
}

export const LinkButton: FC<WithButtonProps<ComponentProps<typeof Link>>> = ({ className, variant, size, ...props }) => {
  return (
    <Link {...props} className={cn(button({ variant, size }), className)}></Link>
  )
}
