import type { FC, PropsWithChildren, ButtonHTMLAttributes, AnchorHTMLAttributes, HTMLProps } from "react";
import type { VariantProps } from "tailwind-variants";
import type { LucideIcon } from "lucide-react";
import { tv } from "tailwind-variants";
import { cn } from "../utils/cn";
import Link from "next/link";
import { Spinner } from "./spinner";

const variantStyles = {
  primary: "bg-neutral-800 border-y border-y-neutral-500 text-white",
  outline: "border border-neutral-300",
  ghost: "border border-transparent",
  "ghost-hitslop": "border border-transparent -m-4 p-4",
};

const buttonVariants = tv({
  base: "tracking-tighter font-medium rounded-xl w-fit flex items-center gap-1.5",
  variants: {
    variant: variantStyles,
    size: {
      large: "py-2 px-4",
      default: "py-1.5 px-4 text-sm",
      small: "py-1.25 px-3.5 text-sm",
    },
    asLink: {
      true: "hover:cursor-pointer",
      false: "enabled:hover:cursor-pointer disabled:cursor-not-allowed",
    },
  },
  compoundVariants: [
    { variant: "primary", asLink: false, class: "enabled:hover:brightness-90" },
    { variant: "outline", asLink: false, class: "enabled:hover:backdrop-brightness-95" },
    { variant: "ghost", asLink: false, class: "enabled:hover:backdrop-brightness-95" },
    { variant: "ghost-hitslop", asLink: false, class: "enabled:hover:backdrop-brightness-95" },
    { variant: "primary", asLink: true, class: "hover:brightness-90" },
    { variant: "outline", asLink: true, class: "hover:backdrop-brightness-95" },
    { variant: "ghost", asLink: true, class: "hover:backdrop-brightness-95" },
    { variant: "ghost-hitslop", asLink: true, class: "hover:backdrop-brightness-95" },
  ],
  defaultVariants: {
    variant: "primary",
    size: "default",
    asLink: false,
  },
});

const iconButtonVariants = tv({
  base: "rounded-xl flex items-center justify-center",
  variants: {
    variant: variantStyles,
    size: {
      large: "size-10",
      default: "size-8",
      small: "size-6",
      none: "",
    },
    asLink: {
      true: "hover:cursor-pointer aspect-square",
      false: "enabled:hover:cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed",
    },
  },
  compoundVariants: [
    { variant: "primary", asLink: false, class: "enabled:hover:brightness-90" },
    { variant: "outline", asLink: false, class: "enabled:hover:backdrop-brightness-95" },
    { variant: "ghost", asLink: false, class: "enabled:hover:backdrop-brightness-95" },
    { variant: "ghost-hitslop", asLink: false, class: "enabled:hover:backdrop-brightness-95" },
    { variant: "primary", asLink: true, class: "hover:brightness-90" },
    { variant: "outline", asLink: true, class: "hover:backdrop-brightness-95" },
    { variant: "ghost", asLink: true, class: "hover:backdrop-brightness-95" },
    { variant: "ghost-hitslop", asLink: true, class: "hover:backdrop-brightness-95" },
  ],
  defaultVariants: {
    variant: "primary",
    size: "default",
    asLink: false,
  },
});

const iconSizes = {
  large: 20,
  default: 16,
  small: 12,
  none: 16,
} as const;

type ButtonVariantProps = VariantProps<typeof buttonVariants>;

interface ButtonBaseProps extends Omit<ButtonVariantProps, "asLink"> {
  className?: string;
}

interface ButtonAsButtonProps
  extends ButtonBaseProps,
    Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof ButtonBaseProps> {
  href?: never;
  isLoading?: boolean;
}

interface ButtonAsLinkProps
  extends ButtonBaseProps,
    Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof ButtonBaseProps | "href"> {
  href: string;
  isLoading?: never;
}

type ButtonProps = ButtonAsButtonProps | ButtonAsLinkProps;

const Button: FC<PropsWithChildren<ButtonProps>> = (props) => {
  const { children, variant, size, className } = props;

  if ("href" in props && props.href !== undefined) {
    const { href, variant: _variant, size: _size, className: _className, ...linkProps } = props;
    const resolvedClassName = buttonVariants({ variant, size, asLink: true, className });

    return (
      <Link draggable={false} href={href} className={resolvedClassName} {...linkProps}>
        {children}
      </Link>
    );
  }

  const { isLoading, disabled, variant: _variant, size: _size, className: _className, ...buttonProps } = props as ButtonAsButtonProps;
  const resolvedClassName = buttonVariants({ variant, size, asLink: false, className });
  const isDisabledNotLoading = disabled && !isLoading;

  return (
    <button
      className={cn(resolvedClassName, isDisabledNotLoading && "opacity-50")}
      disabled={isLoading || disabled}
      {...buttonProps}
    >
      <div className="w-full grid grid-cols-[1fr_max-content_1fr] items-center">
        {isLoading && <Spinner className="col-start-1 size-4" />}
        <div className={cn("col-start-2 flex items-center gap-1", isLoading && "opacity-50")}>
          {children}
        </div>
      </div>
    </button>
  );
};

type IconButtonVariantProps = VariantProps<typeof iconButtonVariants>;

interface IconButtonBaseProps extends Omit<IconButtonVariantProps, "asLink"> {
  icon: LucideIcon;
  className?: string;
}

interface IconButtonAsButtonProps
  extends IconButtonBaseProps,
    Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof IconButtonBaseProps> {
  href?: never;
}

interface IconButtonAsLinkProps
  extends IconButtonBaseProps,
    Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof IconButtonBaseProps | "href"> {
  href: string;
}

type IconButtonProps = IconButtonAsButtonProps | IconButtonAsLinkProps;

const IconButton: FC<IconButtonProps> = (props) => {
  const { icon: Icon, variant, size, className } = props;
  const iconSize = iconSizes[size ?? "default"];

  if ("href" in props && props.href !== undefined) {
    const { href, icon: _icon, variant: _variant, size: _size, className: _className, ...linkProps } = props;
    const resolvedClassName = iconButtonVariants({ variant, size, asLink: true, className });

    return (
      <Link draggable={false} href={href} className={resolvedClassName} {...linkProps}>
        <Icon size={iconSize} />
      </Link>
    );
  }

  const { icon: _icon, variant: _variant, size: _size, className: _className, ...buttonProps } = props as IconButtonAsButtonProps;
  const resolvedClassName = iconButtonVariants({ variant, size, asLink: false, className });

  return (
    <button className={resolvedClassName} {...buttonProps}>
      <Icon size={iconSize} />
    </button>
  );
};

const ButtonText: FC<PropsWithChildren & HTMLProps<HTMLSpanElement>> = ({ children, ...props }) => (
  <span {...props} className={cn("text-nowrap", props.className)}>{children}</span>
);

interface ButtonIconProps {
  icon: LucideIcon;
}

const ButtonIcon: FC<ButtonIconProps> = ({ icon: Icon }) => <Icon size={14} className="-mr-1" />;

export { Button, IconButton, ButtonText, ButtonIcon };
export type { ButtonProps, IconButtonProps };
