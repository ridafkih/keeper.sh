import type { SelectHTMLAttributes, Ref } from "react";
import { clsx } from "clsx";
import { ChevronDown } from "lucide-react";

type DropdownSize = "default" | "small";

interface DropdownProps extends SelectHTMLAttributes<HTMLSelectElement> {
  className?: string;
  dropdownSize?: DropdownSize;
  ref?: Ref<HTMLSelectElement>;
}

const sizeStyles: Record<DropdownSize, string> = {
  default: "py-2 pl-4 pr-10 text-base",
  small: "py-1.5 pl-3 pr-8 text-sm",
};

const iconSizeStyles: Record<DropdownSize, string> = {
  default: "right-4",
  small: "right-3",
};

const Dropdown = ({ className, disabled, dropdownSize = "default", children, ref, ...props }: DropdownProps) => (
  <div className="relative w-full">
    <select
      ref={ref}
      disabled={disabled}
      className={clsx(
        "w-full appearance-none border border-neutral-300 rounded-full transition-colors tracking-tight bg-white",
        "focus:outline-none focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200",
        sizeStyles[dropdownSize],
        disabled && "bg-neutral-100 text-neutral-400 cursor-not-allowed",
        className,
      )}
      {...props}
    >
      {children}
    </select>
    <ChevronDown
      size={dropdownSize === "small" ? 14 : 16}
      className={clsx(
        "absolute top-1/2 -translate-y-1/2 pointer-events-none text-neutral-400",
        iconSizeStyles[dropdownSize],
      )}
    />
  </div>
);

export { Dropdown };
export type { DropdownSize };
