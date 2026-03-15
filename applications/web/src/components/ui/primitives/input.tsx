import type { ComponentPropsWithoutRef, Ref } from "react";
import { tv, type VariantProps } from "tailwind-variants/lite";

const input = tv({
  base: "w-full rounded-xl border border-interactive-border bg-background px-4 py-2.5 text-foreground tracking-tight placeholder:text-foreground-muted disabled:opacity-50 disabled:cursor-not-allowed read-only:cursor-not-allowed read-only:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
  variants: {
    tone: {
      neutral: "",
      error: "border-destructive dark:border-destructive",
    },
  },
  defaultVariants: {
    tone: "neutral",
  },
});

type InputProps = ComponentPropsWithoutRef<"input"> & VariantProps<typeof input> & {
  ref?: Ref<HTMLInputElement>;
};

export function Input({ tone, className, ref, ...props }: InputProps) {
  return <input ref={ref} className={input({ tone, className })} {...props} />;
}
