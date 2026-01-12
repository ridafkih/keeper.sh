import type { SelectHTMLAttributes, Ref } from "react";
import { clsx } from "clsx";
import { ChevronDown } from "lucide-react";

type SelectSize = "default" | "small";

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  className?: string;
  selectSize?: SelectSize;
  ref?: Ref<HTMLSelectElement>;
}

const sizeStyles: Record<SelectSize, string> = {
  default: "py-2 pl-4 pr-10 text-base",
  small: "py-1.5 pl-3 pr-8 text-sm",
};

const iconSizeStyles: Record<SelectSize, string> = {
  default: "right-4",
  small: "right-3",
};

const Select = ({ className, disabled, selectSize = "default", children, ref, ...props }: SelectProps) => (
  <div className="relative w-full">
    <select
      ref={ref}
      disabled={disabled}
      className={clsx(
        "w-full appearance-none border border-neutral-300 rounded-xl transition-colors tracking-tight bg-white",
        "focus:outline-none focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200",
        sizeStyles[selectSize],
        disabled && "bg-neutral-100 text-neutral-400 cursor-not-allowed",
        className,
      )}
      {...props}
    >
      {children}
    </select>
    <ChevronDown
      size={selectSize === "small" ? 14 : 16}
      className={clsx(
        "absolute top-1/2 -translate-y-1/2 pointer-events-none text-neutral-400",
        iconSizeStyles[selectSize],
      )}
    />
  </div>
);

export { Select };
export type { SelectSize };
