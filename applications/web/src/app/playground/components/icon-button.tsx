import type { FC, ButtonHTMLAttributes } from "react";
import type { VariantProps } from "tailwind-variants";
import type { LucideIcon } from "lucide-react";
import { tv } from "tailwind-variants";
import { buttonVariantStyles, iconSizes } from "../styles/buttons";

const iconButtonVariants = tv({
  base: "rounded-full enabled:hover:cursor-pointer flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed aspect-square",
  variants: {
    variant: buttonVariantStyles,
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
