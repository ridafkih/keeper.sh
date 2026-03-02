import type { ComponentPropsWithoutRef, PropsWithChildren } from "react";
import { tv, type VariantProps } from "tailwind-variants/lite";

const button = tv({
  base: "flex items-center gap-1 rounded-xl tracking-tighter border hover:cursor-pointer w-fit font-light",
  variants: {
    size: {
      compact: "px-3 py-1.5 text-sm",
      standard: "px-4 py-2.5",
    },
    variant: {
      highlight: "shadow-xs border-transparent bg-foreground text-background hover:bg-foreground-hover",
      border: "border-interactive-border shadow-xs bg-background hover:bg-background-hover",
      ghost: "border-transparent bg-background hover:bg-background-hover",
    },
  },
  defaultVariants: {
    size: "standard",
    variant: "highlight",
  }
})

type ButtonOptions = ComponentPropsWithoutRef<"button"> & VariantProps<typeof button>;

export function Button({ children, size, variant, className, ...props }: ButtonOptions) {
  return (
    <button className={button({ size, variant, className })} {...props}>{children}</button>
  )
}

export function ButtonText({ children }: PropsWithChildren) {
  return <span className="font-medium">{children}</span>
}

export function ButtonIcon({ children }: PropsWithChildren) {
  return <div className="*:[svg]:sizeA">{children}</div>
}
