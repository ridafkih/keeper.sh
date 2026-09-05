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
  base: "transition-[background-color,opacity] duration-150",
  variants: {
    period: {
      past: "data-active:bg-background-hover",
      today: "data-active:bg-emerald-400/8",
      future: "data-active:bg-emerald-400/8",
    },
  },
});
