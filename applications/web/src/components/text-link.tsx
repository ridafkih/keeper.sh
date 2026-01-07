import type { ComponentProps, FC, PropsWithChildren } from "react";
import Link from "next/link";
import { tv } from "tailwind-variants";

const textLink = tv({
  base: "text-xs text-foreground-muted hover:text-foreground transition-colors",
});

type LinkProps = ComponentProps<typeof Link>;

interface TextLinkProps extends Omit<LinkProps, "className"> {
  className?: string;
}

export const TextLink: FC<PropsWithChildren<TextLinkProps>> = ({
  className,
  children,
  ...props
}) => (
  <Link className={textLink({ className })} {...props}>
    {children}
  </Link>
);
