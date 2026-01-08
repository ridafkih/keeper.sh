import type { FC, AnchorHTMLAttributes } from "react";
import type { VariantProps } from "tailwind-variants";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { iconButtonLinkVariants, iconSizes } from "../styles/buttons";

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
