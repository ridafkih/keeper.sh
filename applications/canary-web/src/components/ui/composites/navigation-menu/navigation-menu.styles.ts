import { tv, type VariantProps } from "tailwind-variants/lite";

export const navigationMenuStyle = tv({
  base: "flex flex-col rounded-2xl p-0.5",
  variants: {
    variant: {
      default: "bg-background-elevated border border-border-elevated shadow-xs",
      highlight: "bg-foreground",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

export type MenuVariant = VariantProps<typeof navigationMenuStyle>["variant"];

export const navigationMenuItemStyle = tv({
  base: "rounded-xl flex items-center gap-3 p-3.5 sm:p-3 w-full",
  variants: {
    variant: {
      default: "",
      highlight: "bg-foreground",
    },
    interactive: {
      true: "hover:cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      false: "",
    },
  },
  compoundVariants: [
    { variant: "default", interactive: true, className: "hover:bg-background-hover" },
    { variant: "highlight", interactive: true, className: "hover:bg-background-inverse-hover" },
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
      highlight: "text-foreground-inverse",
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

export const LABEL_TONE: Record<NonNullable<MenuVariant>, "muted" | "inverse"> = {
  default: "muted",
  highlight: "inverse",
};

export const DISABLED_LABEL_TONE: Record<
  NonNullable<MenuVariant>,
  "disabled" | "inverseMuted"
> = {
  default: "disabled",
  highlight: "inverseMuted",
};
