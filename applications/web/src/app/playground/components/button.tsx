import type { FC, PropsWithChildren, ButtonHTMLAttributes, AnchorHTMLAttributes, HTMLProps } from "react";
import type { VariantProps } from "tailwind-variants";
import type { LucideIcon } from "lucide-react";
import { tv } from "tailwind-variants";
import Link from "next/link";
import clsx from "clsx";
import { Spinner } from "./spinner";

const sharedVariants = {
  primary: "bg-neutral-800 border-y border-y-neutral-500 text-white hover:brightness-90",
  outline: "border border-neutral-300 hover:backdrop-brightness-95",
  ghost: "border border-transparent hover:backdrop-brightness-95",
};

const buttonVariants = tv({
  base: "tracking-tighter font-medium rounded-full w-fit hover:cursor-pointer flex items-center gap-1.5",
  variants: {
    variant: sharedVariants,
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

const iconButtonVariants = tv({
  base: "rounded-full hover:cursor-pointer flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed",
  variants: {
    variant: sharedVariants,
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

type ButtonVariantProps = VariantProps<typeof buttonVariants>;

interface ButtonBaseProps extends ButtonVariantProps {
  className?: string;
  isLoading?: boolean;
}

interface ButtonAsButtonProps
  extends ButtonBaseProps, Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof ButtonBaseProps> {
  href?: undefined;
}

interface ButtonAsLinkProps
  extends
    ButtonBaseProps,
    Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof ButtonBaseProps | "href"> {
  href: string;
}

type ButtonProps = ButtonAsButtonProps | ButtonAsLinkProps;

const extractButtonProps = (props: ButtonAsButtonProps) => {
  const {
    variant: _variant,
    size: _size,
    className: _className,
    href: _href,
    isLoading: _isLoading,
    ...buttonProps
  } = props;
  return buttonProps;
};

const Button: FC<PropsWithChildren<ButtonProps>> = (props) => {
  const { children, variant, size, className, href, isLoading } = props;

  const resolvedClassName = buttonVariants({ variant, size, className });

  if (href !== undefined) {
    return (
      <Link href={href} target={props.target} className={resolvedClassName}>
        {children}
      </Link>
    );
  }

  const buttonProps = extractButtonProps(props);

  return (
    <button
      className={resolvedClassName}
      disabled={isLoading || buttonProps.disabled}
      {...buttonProps}
    >
      <div className="w-full grid grid-cols-[1fr_max-content_1fr] items-center">
        {isLoading && <Spinner className="col-start-1 size-4" />}
        <div className="col-start-2 flex items-center gap-1">
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

type IconButtonVariantProps = VariantProps<typeof iconButtonVariants>;

interface IconButtonBaseProps extends IconButtonVariantProps {
  icon: LucideIcon;
  className?: string;
}

interface IconButtonAsButtonProps
  extends IconButtonBaseProps,
    Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof IconButtonBaseProps> {
  href?: undefined;
}

interface IconButtonAsLinkProps
  extends IconButtonBaseProps,
    Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof IconButtonBaseProps | "href"> {
  href: string;
}

type IconButtonProps = IconButtonAsButtonProps | IconButtonAsLinkProps;

const iconSizes = {
  large: 20,
  default: 16,
  small: 12,
} as const;

const IconButton: FC<IconButtonProps> = ({
  icon: Icon,
  variant,
  size,
  className,
  href,
  ...props
}) => {
  const resolvedClassName = iconButtonVariants({ variant, size, className });
  const iconSize = iconSizes[size ?? "default"];

  if (href !== undefined) {
    return (
      <Link href={href} className={resolvedClassName}>
        <Icon size={iconSize} />
      </Link>
    );
  }

  return (
    <button
      className={resolvedClassName}
      {...(props as ButtonHTMLAttributes<HTMLButtonElement>)}
    >
      <Icon size={iconSize} />
    </button>
  );
};

export { Button, ButtonText, ButtonIcon, IconButton };
