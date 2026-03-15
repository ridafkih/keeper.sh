import type { ComponentPropsWithoutRef, PropsWithChildren } from "react";
import { Link } from "@tanstack/react-router";
import { tv, type VariantProps } from "tailwind-variants/lite";

const button = tv({
  base: "flex items-center gap-1 rounded-xl tracking-tighter border hover:cursor-pointer w-fit font-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 disabled:pointer-events-none",
  variants: {
    size: {
      compact: "px-3 py-1.5 text-sm",
      standard: "px-4 py-2.5",
    },
    variant: {
      highlight: "shadow-xs border-transparent bg-foreground text-background hover:bg-foreground-hover",
      border: "border-interactive-border shadow-xs bg-background hover:bg-background-hover",
      elevated: "border-border-elevated shadow-xs bg-background-elevated hover:bg-background-hover",
      ghost: "border-transparent bg-transparent hover:bg-foreground/5",
      inverse: "shadow-xs border-transparent bg-white text-neutral-900 hover:bg-neutral-200",
      "inverse-ghost": "border-transparent bg-transparent text-neutral-300 hover:bg-white/10 hover:text-white",
      destructive: "shadow-xs border-destructive-border bg-destructive-background text-destructive hover:bg-destructive-background-hover",
    },
  },
  defaultVariants: {
    size: "standard",
    variant: "highlight",
  }
})

export type ButtonProps = VariantProps<typeof button>;
type ButtonOptions = ComponentPropsWithoutRef<"button"> & ButtonProps;
type LinkButtonOptions = Omit<ComponentPropsWithoutRef<typeof Link>, "children" | "className"> &
  PropsWithChildren<VariantProps<typeof button> & { className?: string }>;
type ExternalLinkButtonOptions = ComponentPropsWithoutRef<"a"> & VariantProps<typeof button>;

export function Button({ children, size, variant, className, ...props }: ButtonOptions) {
  return (
    <button draggable={false} className={button({ size, variant, className })} {...props}>{children}</button>
  )
}

export function LinkButton({ children, size, variant, className, ...props }: LinkButtonOptions) {
  return (
    <Link className={button({ size, variant, className })} {...props}>{children}</Link>
  )
}

export function ExternalLinkButton({ children, size, variant, className, ...props }: ExternalLinkButtonOptions) {
  return (
    <a className={button({ size, variant, className })} {...props}>{children}</a>
  )
}

export function ButtonText({ children }: PropsWithChildren) {
  return <span className="font-medium">{children}</span>
}

export function ButtonIcon({ children }: PropsWithChildren) {
  return children
}
