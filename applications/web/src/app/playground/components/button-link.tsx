import type { FC, PropsWithChildren, AnchorHTMLAttributes } from "react";
import type { VariantProps } from "tailwind-variants";
import { tv } from "tailwind-variants";
import Link from "next/link";
import { linkVariantStyles } from "../styles/buttons";

const buttonLinkVariants = tv({
  base: "tracking-tighter font-medium rounded-full w-fit hover:cursor-pointer flex items-center gap-1.5",
  variants: {
    variant: linkVariantStyles,
    size: {
      large: "py-2 px-4",
      default: "py-1.5 px-4 text-sm",
      small: "py-1.25 px-3.5 text-sm",
    },
  },
  defaultVariants: {
    variant: "primary",
    size: "default",
  },
});

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
