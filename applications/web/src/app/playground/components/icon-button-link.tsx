import type { FC, AnchorHTMLAttributes } from "react";
import type { VariantProps } from "tailwind-variants";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { iconButtonVariants, iconSizes } from "../styles/buttons";

type IconButtonLinkVariantProps = VariantProps<typeof iconButtonVariants>;

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
  const resolvedClassName = iconButtonVariants({ variant, size, className });
  const iconSize = iconSizes[size ?? "default"];

  return (
    <Link draggable={false} href={href} className={resolvedClassName} {...linkProps}>
      <Icon size={iconSize} />
    </Link>
  );
};

export { IconButtonLink };
export type { IconButtonLinkProps };
