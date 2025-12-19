import { tv } from "tailwind-variants";

export const button = tv({
  base: "inline-flex items-center justify-center py-2 px-4 rounded-md text-sm font-medium no-underline cursor-pointer transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900",
  variants: {
    variant: {
      primary:
        "bg-gray-900 border border-gray-900 text-white hover:bg-gray-700 hover:border-gray-700",
      secondary:
        "bg-transparent border border-gray-300 text-gray-700 hover:bg-gray-50 hover:border-gray-400",
    },
  },
  defaultVariants: {
    variant: "primary",
  },
});

export const submitButton = tv({
  base: "w-full py-3 px-4 mt-2 border-none rounded-md text-base font-medium bg-gray-900 text-white cursor-pointer transition-colors duration-150 hover:bg-gray-700 disabled:bg-gray-400 disabled:cursor-not-allowed",
});

export const input = tv({
  base: "w-full py-2.5 px-3 border border-gray-300 rounded-md text-base transition-[border-color,box-shadow] duration-150 focus:outline-none focus:border-gray-900 focus:ring-3 focus:ring-black/10",
});

export const label = tv({
  base: "block text-sm font-medium mb-1.5 text-gray-700",
});

export const navLink = tv({
  base: "flex items-center px-3 py-2 rounded-md text-sm font-medium no-underline transition-colors",
  variants: {
    active: {
      true: "bg-gray-100 text-gray-900",
      false: "text-gray-600 hover:text-gray-900 hover:bg-gray-100",
    },
  },
  defaultVariants: {
    active: false,
  },
});

export const sidebarLink = tv({
  base: "px-3 py-2 rounded-md text-sm font-medium no-underline transition-colors",
  variants: {
    active: {
      true: "bg-gray-100 text-gray-900",
      false: "text-gray-600 hover:text-gray-900 hover:bg-gray-50",
    },
  },
  defaultVariants: {
    active: false,
  },
});

export const link = tv({
  base: "text-gray-900 font-medium no-underline hover:underline",
});

export const brand = tv({
  base: "text-2xl font-bold text-gray-900 no-underline",
});
