import type { FC, PropsWithChildren, AnchorHTMLAttributes } from "react";
import type { VariantProps } from "tailwind-variants";
import Link from "next/link";
import { buttonLinkVariants } from "../styles/buttons";

type ButtonLinkVariantProps = VariantProps<typeof buttonLinkVariants>;

interface ButtonLinkProps
  extends ButtonLinkVariantProps,
    Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof ButtonLinkVariantProps | "href"> {
  href: string;
  className?: string;
}

const ButtonLink: FC<PropsWithChildren<ButtonLinkProps>> = ({
  children,
  variant,
  size,
  className,
  href,
  ...linkProps
}) => {
  const resolvedClassName = buttonLinkVariants({ variant, size, className });

  return (
    <Link draggable={false} href={href} className={resolvedClassName} {...linkProps}>
      {children}
    </Link>
  );
};

export { ButtonLink };
export type { ButtonLinkProps };
