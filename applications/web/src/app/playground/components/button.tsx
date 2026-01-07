import type { FC, PropsWithChildren, ButtonHTMLAttributes, AnchorHTMLAttributes } from "react";
import type { VariantProps } from "tailwind-variants";
import type { LucideIcon } from "lucide-react";
import { tv } from "tailwind-variants";
import Link from "next/link";

const buttonVariants = tv({
  base: "tracking-tighter font-medium rounded-full w-fit hover:cursor-pointer flex items-center gap-1.5",
  variants: {
    variant: {
      primary: "bg-neutral-800 border-y border-y-neutral-500 text-white hover:brightness-90",
      outline: "border border-neutral-300 hover:backdrop-brightness-95",
      ghost: "border border-transparent hover:backdrop-brightness-95",
    },
    size: {
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

interface ButtonBaseProps extends ButtonVariantProps {
  className?: string;
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
    ...buttonProps
  } = props;
  return buttonProps;
};

const Button: FC<PropsWithChildren<ButtonProps>> = (props) => {
  const { children, variant, size, className, href } = props;
  const resolvedClassName = buttonVariants({ variant, size, className });

  if (href !== undefined) {
    return (
      <Link href={href} target={props.target} className={resolvedClassName}>
        {children}
      </Link>
    );
  }

  return (
    <button className={resolvedClassName} {...extractButtonProps(props)}>
      {children}
    </button>
  );
};

const ButtonText: FC<PropsWithChildren> = ({ children }) => (
  <span className="text-nowrap">{children}</span>
);

interface ButtonIconProps {
  icon: LucideIcon;
}

const ButtonIcon: FC<ButtonIconProps> = ({ icon: Icon }) => <Icon size={14} className="-mr-1" />;

export { Button, ButtonText, ButtonIcon };
