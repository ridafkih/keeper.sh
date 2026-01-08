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

const iconSizes = {
  large: 20,
  default: 16,
  small: 12,
} as const;

export { buttonVariantStyles, linkVariantStyles, iconSizes };
