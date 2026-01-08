import { tv } from "tailwind-variants";

const buttonVariantStyles = {
  primary: "bg-neutral-800 border-y border-y-neutral-500 text-white enabled:hover:brightness-90",
  outline: "border border-neutral-300 enabled:hover:backdrop-brightness-95",
  ghost: "border border-transparent enabled:hover:backdrop-brightness-95",
};

const linkVariantStyles = {
  primary: "bg-neutral-800 border-y border-y-neutral-500 text-white hover:brightness-90",
  outline: "border border-neutral-300 hover:backdrop-brightness-95",
  ghost: "border border-transparent hover:backdrop-brightness-95",
};

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

const buttonLinkVariants = tv({
  base: "tracking-tighter font-medium rounded-full w-fit hover:cursor-pointer flex items-center gap-1.5",
  variants: {
    variant: linkVariantStyles,
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

const iconSizes = {
  large: 20,
  default: 16,
  small: 12,
} as const;

export { buttonVariants, buttonLinkVariants, iconButtonVariants, iconButtonLinkVariants, iconSizes };
