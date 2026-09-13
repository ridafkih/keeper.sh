import type { ReactNode } from "react";
import ChevronsUpDown from "lucide-react/dist/esm/icons/chevrons-up-down";
import Plus from "lucide-react/dist/esm/icons/plus";
import { tv } from "tailwind-variants/lite";

export type BlankState = "empty" | "filled" | "open";

const blank = tv({
  base: "inline-flex max-w-full items-center gap-1.5 rounded-lg border px-2 py-0.5 align-baseline font-sans text-base font-normal tracking-tight hover:cursor-pointer hover:bg-background-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
  variants: {
    state: {
      empty: "border-dashed border-interactive-border text-foreground-muted",
      filled: "border-interactive-border bg-background text-foreground",
      open: "border-interactive-border bg-background text-foreground ring-2 ring-ring",
    },
  },
});

interface SentenceBlankProps {
  state: BlankState;
  label?: string;
  ariaLabel?: string;
  icon?: ReactNode;
  onClick: () => void;
}

export function SentenceBlank({ state, label, ariaLabel, icon, onClick }: SentenceBlankProps) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-expanded={state === "open"}
      onClick={onClick}
      className={blank({ state })}
    >
      {state === "empty" ? <Plus size={14} className="shrink-0" /> : icon}
      {label && <span className="min-w-0 truncate">{label}</span>}
      {label && <ChevronsUpDown size={14} className="shrink-0 text-foreground-muted" />}
    </button>
  );
}
