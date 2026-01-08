import type { FC, ButtonHTMLAttributes } from "react";
import type { VariantProps } from "tailwind-variants";
import type { LucideIcon } from "lucide-react";
import { iconButtonVariants, iconSizes } from "../styles/buttons";

type IconButtonVariantProps = VariantProps<typeof iconButtonVariants>;

interface IconButtonProps
  extends IconButtonVariantProps,
    Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof IconButtonVariantProps> {
  icon: LucideIcon;
  className?: string;
}

const IconButton: FC<IconButtonProps> = ({
  icon: Icon,
  variant,
  size,
  className,
  ...buttonProps
}) => {
  const resolvedClassName = iconButtonVariants({ variant, size, className });
  const iconSize = iconSizes[size ?? "default"];

  return (
    <button className={resolvedClassName} {...buttonProps}>
      <Icon size={iconSize} />
    </button>
  );
};

export { IconButton };
export type { IconButtonProps };
