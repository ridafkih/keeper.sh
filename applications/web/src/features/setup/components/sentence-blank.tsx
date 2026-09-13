import type { ReactNode } from "react";
import ChevronsUpDown from "lucide-react/dist/esm/icons/chevrons-up-down";
import Plus from "lucide-react/dist/esm/icons/plus";
import { tv } from "tailwind-variants/lite";

const blank = tv({
  base: "inline-flex max-w-[min(100%,14rem)] items-center gap-1.5 rounded-lg border px-2 py-0.5 align-baseline font-sans text-base font-normal leading-6 tracking-tight hover:cursor-pointer hover:bg-background-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
  variants: {
    filled: {
      true: "border-interactive-border bg-background text-foreground",
      false: "border-dashed border-interactive-border text-foreground-muted",
    },
    open: {
      true: "border-ring ring-1 ring-inset ring-ring",
      false: "",
    },
  },
});

interface SentenceBlankProps {
  filled: boolean;
  open: boolean;
  label?: string;
  ariaLabel?: string;
  icon?: ReactNode;
  onClick: () => void;
}

export function SentenceBlank({ filled, open, label, ariaLabel, icon, onClick }: SentenceBlankProps) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-expanded={open}
      onClick={onClick}
      className={blank({ filled, open })}
    >
      <span aria-hidden className="w-0 select-none">{"\u200B"}</span>
      {filled ? icon : <Plus size={14} className="shrink-0" />}
      {label && <span className="min-w-0 truncate">{label}</span>}
      {label && <ChevronsUpDown size={14} className="shrink-0 text-foreground-muted" />}
    </button>
  );
}
