import { FC, ReactNode, ButtonHTMLAttributes } from "react";
import { tv, type VariantProps } from "tailwind-variants";
import { LucideIcon } from "lucide-react";

const buttonVariants = tv({
  base: "tracking-tighter font-medium rounded-full w-fit py-1.5 px-4 text-sm hover:cursor-pointer flex items-center gap-1.5",
  variants: {
    variant: {
      primary:
        "border bg-neutral-800 text-white border-neutral-600 hover:brightness-90",
      outline:
        "border border-neutral-300 hover:backdrop-brightness-95",
      ghost:
        "border border-transparent hover:backdrop-brightness-95",
    },
  },
  defaultVariants: {
    variant: "primary",
  },
});

type ButtonVariantProps = VariantProps<typeof buttonVariants>;

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  ButtonVariantProps & {
    children: ReactNode;
  };

export const Button: FC<ButtonProps> = ({
  children,
  variant,
  className,
  ...props
}) => (
  <button className={buttonVariants({ variant, className })} {...props}>
    {children}
  </button>
);

type ButtonTextProps = {
  children: ReactNode;
};

export const ButtonText: FC<ButtonTextProps> = ({ children }) => (
  <span className="text-nowrap">{children}</span>
);

type ButtonIconProps = {
  icon: LucideIcon;
};

export const ButtonIcon: FC<ButtonIconProps> = ({ icon: Icon }) => (
  <Icon size={14} className="-mr-1" />
);
