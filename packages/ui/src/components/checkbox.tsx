import type { InputHTMLAttributes, Ref } from "react";
import { cn } from "../utils/cn";
import { Check } from "lucide-react";
import { tv } from "tailwind-variants";

type CheckboxSize = "default" | "small";

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "size"> {
  className?: string;
  size?: CheckboxSize;
  label?: string;
  ref?: Ref<HTMLInputElement>;
}

const checkboxVariants = tv({
  slots: {
    box: [
      "flex items-center justify-center",
      "border border-input rounded-md transition-colors bg-surface",
      "peer-focus:ring-2 peer-focus:ring-border peer-focus:border-input",
      "peer-focus-visible:ring-border-input",
      "peer-checked:bg-primary peer-checked:border-primary",
    ],
    icon: "text-white opacity-0 peer-checked:opacity-100 transition-opacity",
    label: "text-foreground-secondary text-xs",
  },
  variants: {
    size: {
      default: {
        box: "size-4",
      },
      small: {
        box: "size-3.5",
      },
    },
  },
  defaultVariants: {
    size: "default",
  },
});

const iconSizes: Record<CheckboxSize, number> = {
  default: 10,
  small: 8,
};

const Checkbox = ({ className, disabled, size = "default", label, id, ref, ...props }: CheckboxProps) => {
  const { box, icon, label: labelClass } = checkboxVariants({ size });

  return (
    <label
      htmlFor={id}
      className={cn(
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
        <div className={box()}>
          <Check size={iconSizes[size]} strokeWidth={2.5} className={icon()} />
        </div>
      </div>
      {label && <span className={labelClass()}>{label}</span>}
    </label>
  );
};

Checkbox.displayName = "Checkbox";

export { Checkbox };
export type { CheckboxSize, CheckboxProps };
