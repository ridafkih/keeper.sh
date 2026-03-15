import type { ComponentPropsWithoutRef, PropsWithChildren } from "react";
import { Link } from "@tanstack/react-router";
import { tv, type VariantProps } from "tailwind-variants/lite";

const textLink = tv({
  base: "tracking-tight underline underline-offset-2",
  variants: {
    size: {
      base: "text-base",
      sm: "text-sm",
      xs: "text-xs",
    },
    tone: {
      muted: "text-foreground-muted hover:text-foreground",
      default: "text-foreground",
    },
    align: {
      center: "text-center",
      left: "text-left",
    },
  },
  defaultVariants: {
    size: "sm",
    tone: "muted",
    align: "center",
  },
});

type TextLinkProps = Omit<ComponentPropsWithoutRef<typeof Link>, "children" | "className"> &
  PropsWithChildren<VariantProps<typeof textLink> & { className?: string }>;
type ExternalTextLinkProps = ComponentPropsWithoutRef<"a"> &
  PropsWithChildren<VariantProps<typeof textLink> & { className?: string }>;

export function TextLink({ children, size, tone, align, className, ...props }: TextLinkProps) {
  return (
    <Link className={textLink({ size, tone, align, className })} {...props}>
      {children}
    </Link>
  );
}

export function ExternalTextLink({
  children,
  size,
  tone,
  align,
  className,
  ...props
}: ExternalTextLinkProps) {
  return (
    <a className={textLink({ size, tone, align, className })} {...props}>
      {children}
    </a>
  );
}
