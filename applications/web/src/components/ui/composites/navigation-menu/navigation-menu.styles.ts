import { tv, type VariantProps } from "tailwind-variants/lite";

export const navigationMenuStyle = tv({
  base: "flex flex-col gap-px rounded-2xl p-0.5",
  variants: {
    variant: {
      default: "bg-background-elevated border border-border-elevated shadow-xs",
      highlight: "relative before:absolute before:top-0.5 before:inset-x-0 before:h-px before:bg-linear-to-r before:mx-4 before:z-10 before:from-transparent before:to-transparent dark:bg-blue-700 dark:before:via-blue-400 bg-blue-500 before:via-blue-300"
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

export type MenuVariant = VariantProps<typeof navigationMenuStyle>["variant"];

export const navigationMenuItemStyle = tv({
  base: "rounded-[0.875rem] flex items-center gap-3 p-3.5 sm:p-3 w-full",
  variants: {
    variant: {
      default: "",
      highlight: "bg-linear-to-t dark:to-blue-600 dark:from-blue-700 to-blue-500 from-blue-600",
    },
    interactive: {
      true: "hover:cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      false: "",
    },
  },
  compoundVariants: [
    { variant: "default", interactive: true, className: "hover:bg-background-hover" },
    { variant: "highlight", interactive: true, className: "hover:brightness-110" },
  ],
  defaultVariants: {
    variant: "default",
    interactive: true,
  },
});

export const navigationMenuItemIconStyle = tv({
  base: "shrink-0",
  variants: {
    variant: {
      default: "text-foreground-muted",
      highlight: "text-white",
    },
    disabled: {
      true: "text-foreground-disabled",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});


export const navigationMenuToggleTrack = tv({
  base: "w-8 h-5 rounded-full shrink-0 flex items-center p-0.5",
  variants: {
    variant: {
      default: "",
      highlight: "",
    },
    checked: {
      true: "",
      false: "",
    },
    disabled: {
      true: "opacity-30",
      false: "",
    },
  },
  compoundVariants: [
    { variant: "default", checked: false, className: "bg-interactive-border" },
    { variant: "default", checked: true, className: "bg-foreground" },
    { variant: "highlight", checked: false, className: "bg-foreground-inverse-muted" },
    { variant: "highlight", checked: true, className: "bg-foreground-inverse" },
  ],
  defaultVariants: {
    variant: "default",
    checked: false,
    disabled: false,
  },
});

export const navigationMenuToggleThumb = tv({
  base: "size-4 rounded-full",
  variants: {
    variant: {
      default: "bg-background-elevated",
      highlight: "bg-foreground",
    },
    checked: {
      true: "ml-auto",
      false: "",
    },
  },
  defaultVariants: {
    variant: "default",
    checked: false,
  },
});

export const navigationMenuCheckbox = tv({
  base: "size-4 rounded shrink-0 flex items-center justify-center border",
  variants: {
    variant: {
      default: "border-interactive-border",
      highlight: "border-foreground-inverse-muted",
    },
    checked: {
      true: "",
      false: "",
    },
  },
  compoundVariants: [
    { variant: "default", checked: true, className: "bg-foreground border-foreground" },
    { variant: "highlight", checked: true, className: "bg-foreground-inverse border-foreground-inverse" },
  ],
  defaultVariants: {
    variant: "default",
    checked: false,
  },
});

export const navigationMenuCheckboxIcon = tv({
  base: "shrink-0",
  variants: {
    variant: {
      default: "text-foreground-inverse",
      highlight: "text-foreground",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

export const LABEL_TONE: Record<NonNullable<MenuVariant>, "muted" | "inverse" | "highlight"> = {
  default: "muted",
  highlight: "highlight",
};

export const DISABLED_LABEL_TONE: Record<
  NonNullable<MenuVariant>,
  "disabled" | "inverseMuted" | "highlight"
> = {
  default: "disabled",
  highlight: "highlight",
};
