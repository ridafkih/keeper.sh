import type { FC, PropsWithChildren, ButtonHTMLAttributes, HTMLProps } from "react";
import type { VariantProps } from "tailwind-variants";
import type { LucideIcon } from "lucide-react";
import { tv } from "tailwind-variants";
import clsx from "clsx";
import { Spinner } from "./spinner";
import { buttonVariantStyles } from "../styles/buttons";

const buttonVariants = tv({
  base: "tracking-tighter font-medium rounded-full w-fit enabled:hover:cursor-pointer flex items-center gap-1.5 disabled:cursor-not-allowed",
  variants: {
    variant: buttonVariantStyles,
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

type ButtonVariantProps = VariantProps<typeof buttonVariants>;

interface ButtonProps
  extends ButtonVariantProps,
    Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof ButtonVariantProps> {
  className?: string;
  isLoading?: boolean;
}

const Button: FC<PropsWithChildren<ButtonProps>> = ({
  children,
  variant,
  size,
  className,
  isLoading,
  disabled,
  ...buttonProps
}) => {
  const resolvedClassName = buttonVariants({ variant, size, className });
  const isDisabledNotLoading = disabled && !isLoading;

  return (
    <button
      className={clsx(resolvedClassName, isDisabledNotLoading && "opacity-50")}
      disabled={isLoading || disabled}
      {...buttonProps}
    >
      <div className="w-full grid grid-cols-[1fr_max-content_1fr] items-center">
        {isLoading && <Spinner className="col-start-1 size-4" />}
        <div className={clsx("col-start-2 flex items-center gap-1", isLoading && "opacity-50")}>
          {children}
        </div>
      </div>
    </button>
  );
};

const ButtonText: FC<PropsWithChildren & HTMLProps<HTMLSpanElement>> = ({ children, ...props }) => (
  <span {...props} className={clsx("text-nowrap", props.className)}>{children}</span>
);

interface ButtonIconProps {
  icon: LucideIcon;
}

const ButtonIcon: FC<ButtonIconProps> = ({ icon: Icon }) => <Icon size={14} className="-mr-1" />;

export { Button, ButtonText, ButtonIcon };
export type { ButtonProps };
