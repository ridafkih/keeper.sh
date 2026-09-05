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
  base: "duration-150",
  variants: {
    period: {
      past: "[--wash:var(--color-background-hover)]",
      today: "[--wash:color-mix(in_oklab,var(--color-emerald-400)_8%,transparent)]",
      future: "[--wash:color-mix(in_oklab,var(--color-emerald-400)_8%,transparent)]",
    },
    edge: {
      flat: "transition-[background-color,opacity] data-active:bg-(--wash)",
      fadeTop:
        "relative isolate transition-opacity before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:bg-[linear-gradient(to_bottom,transparent,var(--wash)_1.5rem)] before:opacity-0 before:transition-opacity before:duration-150 data-active:before:opacity-100",
    },
  },
  defaultVariants: { edge: "flat" },
});
