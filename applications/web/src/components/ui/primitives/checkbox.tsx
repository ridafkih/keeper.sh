import type { ReactNode } from "react";
import Check from "lucide-react/dist/esm/icons/check";
import { tv } from "tailwind-variants/lite";
import { cn } from "@/utils/cn";
import { Text } from "./text";

const checkboxIndicator = tv({
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

const checkboxIcon = tv({
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

type CheckboxVariant = "default" | "highlight";

interface CheckboxIndicatorProps {
  checked: boolean;
  variant?: CheckboxVariant;
  className?: string;
}

export function CheckboxIndicator({ checked, variant, className }: CheckboxIndicatorProps) {
  return (
    <div className={checkboxIndicator({ variant, checked, className })}>
      {checked && <Check size={12} className={checkboxIcon({ variant })} />}
    </div>
  );
}

interface CheckboxProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  children?: ReactNode;
  className?: string;
}

export function Checkbox({ checked, onCheckedChange, children, className }: CheckboxProps) {
  return (
    <label className={cn("flex items-center gap-2 cursor-pointer", className)}>
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        onClick={() => onCheckedChange(!checked)}
        className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
      >
        <CheckboxIndicator checked={checked} />
      </button>
      {children && <Text as="span" size="sm">{children}</Text>}
    </label>
  );
}
