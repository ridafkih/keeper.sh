import { tv } from "tailwind-variants";

export const button = tv({
  base: "inline-flex items-center justify-center rounded-md font-medium no-underline cursor-pointer transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:border-zinc-300",
  variants: {
    variant: {
      primary:
        "bg-zinc-900 border border-zinc-900 text-white hover:bg-zinc-700 hover:border-zinc-700 disabled:hover:bg-zinc-900 disabled:hover:border-zinc-900",
      secondary:
        "bg-transparent border border-zinc-300 text-zinc-700 hover:bg-zinc-50 hover:border-zinc-400",
      danger:
        "bg-transparent border border-red-300 text-red-600 hover:bg-red-50",
    },
    size: {
      default: "py-2 px-4 text-sm",
      sm: "py-1.5 px-3 text-sm",
      xs: "py-1.5 px-3 text-xs",
    },
    skeleton: {
      true: "opacity-0",
    },
  },
  defaultVariants: {
    size: "default",
  },
});

export const input = tv({
  base: "w-full border border-zinc-300 rounded-md transition-[border-color,box-shadow] duration-150 focus:outline-none focus:border-zinc-900 focus:ring-3 focus:ring-black/10",
  variants: {
    readonly: {
      true: "bg-zinc-50 text-zinc-600",
    },
    size: {
      default: "py-2.5 px-3 text-base",
      sm: "py-1.5 px-2 text-sm",
    },
  },
  defaultVariants: {
    size: "default",
  },
});

export const dialogPopup = tv({
  base: "fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white border border-zinc-200 rounded-md shadow-lg p-4 w-full",
  variants: {
    size: {
      sm: "max-w-xs",
      md: "max-w-sm",
      lg: "max-w-md",
    },
  },
  defaultVariants: {
    size: "sm",
  },
});
