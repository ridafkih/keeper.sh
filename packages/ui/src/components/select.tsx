import type { SelectHTMLAttributes, Ref } from "react";
import { cn } from "../utils/cn";
import { ChevronDown } from "lucide-react";
import { tv } from "tailwind-variants";

type SelectSize = "default" | "small";

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> {
  className?: string;
  size?: SelectSize;
  ref?: Ref<HTMLSelectElement>;
}

const selectVariants = tv({
  slots: {
    select: [
      "w-full appearance-none border border-input rounded-xl transition-colors tracking-tight bg-surface",
      "focus:outline-none focus:border-input focus:ring-2 focus:ring-border",
    ],
    icon: "absolute top-1/2 -translate-y-1/2 pointer-events-none text-foreground-subtle",
  },
  variants: {
    size: {
      default: {
        select: "py-2 pl-4 pr-10 text-base",
        icon: "right-4",
      },
      small: {
        select: "py-1.5 pl-3 pr-8 text-sm",
        icon: "right-3",
      },
    },
    disabled: {
      true: {
        select: "bg-surface-muted text-foreground-subtle cursor-not-allowed",
      },
    },
  },
  defaultVariants: {
    size: "default",
    disabled: false,
  },
});

const iconSizes: Record<SelectSize, number> = {
  default: 16,
  small: 14,
};

const Select = ({ className, disabled = false, size = "default", children, ref, ...props }: SelectProps) => {
  const { select, icon } = selectVariants({ size, disabled });

  return (
    <div className="relative w-full">
      <select ref={ref} disabled={disabled} className={cn(select(), className)} {...props}>
        {children}
      </select>
      <ChevronDown size={iconSizes[size]} className={icon()} />
    </div>
  );
};

Select.displayName = "Select";

export { Select };
export type { SelectSize, SelectProps };
