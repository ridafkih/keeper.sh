import type { InputHTMLAttributes, Ref } from "react";
import { clsx } from "clsx";

type RadioSize = "default" | "small";

interface RadioProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "size"> {
  className?: string;
  radioSize?: RadioSize;
  label?: string;
  ref?: Ref<HTMLInputElement>;
}

const sizeStyles: Record<RadioSize, { outer: string; inner: string; label: string }> = {
  default: { outer: "size-5", inner: "size-2.5", label: "text-base" },
  small: { outer: "size-4", inner: "size-2", label: "text-sm" },
};

const Radio = ({ className, disabled, radioSize = "default", label, id, ref, ...props }: RadioProps) => {
  const styles = sizeStyles[radioSize];

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
          type="radio"
          disabled={disabled}
          className="peer sr-only"
          {...props}
        />
        <div
          className={clsx(
            "border border-neutral-300 rounded-full transition-colors bg-white",
            "peer-focus:ring-2 peer-focus:ring-neutral-200 peer-focus:border-neutral-400",
            "peer-checked:border-neutral-800",
            styles.outer,
          )}
        />
        <div
          className={clsx(
            "absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-neutral-800",
            "scale-0 peer-checked:scale-100 transition-transform",
            styles.inner,
          )}
        />
      </div>
      {label && <span className={clsx("text-neutral-700", styles.label)}>{label}</span>}
    </label>
  );
};

export { Radio };
export type { RadioSize };
