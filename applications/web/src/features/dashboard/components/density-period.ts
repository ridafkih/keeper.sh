import { tv } from "tailwind-variants/lite";

export type Period = "past" | "today" | "future";

export const resolvePeriod = (dayOffset: number): Period => {
  if (dayOffset < 0) return "past";
  if (dayOffset === 0) return "today";
  return "future";
};

export const periodFill = tv({
  variants: {
    period: {
      past: "bg-background-hover border border-border-elevated",
      today: "bg-emerald-400 border-transparent",
      future:
        "bg-emerald-400 border-emerald-500 bg-[repeating-linear-gradient(-45deg,transparent_0_4px,var(--color-illustration-stripe)_4px_8px)]",
    },
  },
});

export const periodWash = tv({
  base: "transition-[background-color,background-image,opacity] duration-150",
  variants: {
    period: {
      past: "[--wash:var(--color-background-hover)]",
      today: "[--wash:color-mix(in_oklab,var(--color-emerald-400)_8%,transparent)]",
      future: "[--wash:color-mix(in_oklab,var(--color-emerald-400)_8%,transparent)]",
    },
    edge: {
      flat: "data-active:bg-(--wash)",
      fadeTop: "data-active:bg-[linear-gradient(to_bottom,transparent,var(--wash)_1.5rem)]",
    },
  },
  defaultVariants: { edge: "flat" },
});
