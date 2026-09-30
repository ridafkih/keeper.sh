import { tv } from "tailwind-variants/lite";

export const heading = tv({
  base: "font-lora font-medium leading-tight -tracking-[0.075em] text-foreground",
  variants: {
    level: {
      1: "text-4xl",
      2: "text-2xl",
      3: "text-xl",
    },
  },
});
