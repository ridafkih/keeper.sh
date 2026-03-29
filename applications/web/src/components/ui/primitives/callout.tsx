import type { ReactNode } from "react";
import { tv } from "tailwind-variants/lite";
import { Text } from "./text";

const calloutStyle = tv({
  base: "rounded-2xl px-2.5 py-2 border",
  variants: {
    tone: {
      amber: "border-amber-200 dark:border-amber-800 bg-[repeating-linear-gradient(135deg,var(--color-amber-50),var(--color-amber-50)_4px,var(--color-amber-100)_4px,var(--color-amber-100)_8px)] dark:bg-[repeating-linear-gradient(135deg,var(--color-amber-950),var(--color-amber-950)_4px,var(--color-amber-900)_4px,var(--color-amber-900)_8px)]",
    },
  },
  defaultVariants: {
    tone: "amber",
  },
});

interface CalloutProps {
  children: ReactNode;
  tone?: "amber";
}

export function Callout({ children, tone = "amber" }: CalloutProps) {
  return (
    <div className={calloutStyle({ tone })}>
      <Text size="sm" tone={tone} className="hyphens-auto break-words">{children}</Text>
    </div>
  );
}
