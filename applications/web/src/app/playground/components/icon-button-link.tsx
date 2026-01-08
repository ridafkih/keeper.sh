import type { FC, AnchorHTMLAttributes } from "react";
import type { VariantProps } from "tailwind-variants";
import type { LucideIcon } from "lucide-react";
import { tv } from "tailwind-variants";
import Link from "next/link";
import { linkVariantStyles, iconSizes } from "../styles/buttons";

const iconButtonLinkVariants = tv({
  base: "rounded-full hover:cursor-pointer flex items-center justify-center aspect-square",
  variants: {
    variant: linkVariantStyles,
    size: {
      large: "size-10",
      default: "size-8",
      small: "size-6",
    },
  },
  defaultVariants: {
    variant: "primary",
    size: "default",
  },
});

type IconButtonLinkVariantProps = VariantProps<typeof iconButtonLinkVariants>;

interface IconButtonLinkProps
  extends IconButtonLinkVariantProps,
    Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof IconButtonLinkVariantProps | "href"> {
  icon: LucideIcon;
  href: string;
  className?: string;
}

const IconButtonLink: FC<IconButtonLinkProps> = ({
  icon: Icon,
  variant,
  size,
  className,
  href,
  ...linkProps
}) => {
  const resolvedClassName = iconButtonLinkVariants({ variant, size, className });
  const iconSize = iconSizes[size ?? "default"];

  return (
    <Link draggable={false} href={href} className={resolvedClassName} {...linkProps}>
      <Icon size={iconSize} />
    </Link>
  );
};

export { IconButtonLink };
export type { IconButtonLinkProps };
