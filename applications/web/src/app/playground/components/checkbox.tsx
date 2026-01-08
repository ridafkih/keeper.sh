import type { InputHTMLAttributes, Ref } from "react";
import { clsx } from "clsx";
import { Check } from "lucide-react";

type CheckboxSize = "default" | "small";

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "size"> {
  className?: string;
  checkboxSize?: CheckboxSize;
  label?: string;
  ref?: Ref<HTMLInputElement>;
}

const sizeStyles: Record<CheckboxSize, { box: string; icon: number; label: string }> = {
  default: { box: "size-5", icon: 14, label: "text-base" },
  small: { box: "size-4", icon: 12, label: "text-sm" },
};

const Checkbox = ({ className, disabled, checkboxSize = "default", label, id, ref, ...props }: CheckboxProps) => {
  const styles = sizeStyles[checkboxSize];

  return (
    <label
      htmlFor={id}
      className={clsx(
        "flex items-center gap-2 cursor-pointer",
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
    >
      <div className="relative">
        <input
          ref={ref}
          id={id}
          type="checkbox"
          disabled={disabled}
          className="peer sr-only"
          {...props}
        />
        <div
          className={clsx(
            "border border-neutral-300 rounded transition-colors bg-white",
            "peer-focus:ring-2 peer-focus:ring-neutral-200 peer-focus:border-neutral-400",
            "peer-checked:bg-neutral-800 peer-checked:border-neutral-800",
            styles.box,
          )}
        />
        <Check
          size={styles.icon}
          strokeWidth={2.5}
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-white opacity-0 peer-checked:opacity-100 transition-opacity"
        />
      </div>
      {label && <span className={clsx("text-neutral-700", styles.label)}>{label}</span>}
    </label>
  );
};

export { Checkbox };
export type { CheckboxSize };
