import type { InputHTMLAttributes, Ref } from "react";
import { cn } from "../utils/cn";
import { tv } from "tailwind-variants";

type RadioSize = "default" | "small";

interface RadioProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "size"> {
  className?: string;
  size?: RadioSize;
  label?: string;
  ref?: Ref<HTMLInputElement>;
}

const radioVariants = tv({
  slots: {
    outer: [
      "flex items-center justify-center",
      "border border-input rounded-full transition-colors bg-surface",
      "peer-focus:ring-2 peer-focus:ring-border peer-focus:border-input",
      "peer-focus-visible:ring-border-input",
      "peer-checked:border-primary",
    ],
    inner: [
      "rounded-full bg-primary",
      "scale-0 peer-checked:scale-100 transition-transform",
    ],
    label: "text-foreground-secondary text-xs",
  },
  variants: {
    size: {
      default: {
        outer: "size-4",
        inner: "size-2",
      },
      small: {
        outer: "size-3.5",
        inner: "size-1.5",
      },
    },
  },
  defaultVariants: {
    size: "default",
  },
});

const Radio = ({ className, disabled, size = "default", label, id, ref, ...props }: RadioProps) => {
  const { outer, inner, label: labelClass } = radioVariants({ size });

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
          type="radio"
          disabled={disabled}
          className="peer sr-only"
          {...props}
        />
        <div className={outer()}>
          <div className={inner()} />
        </div>
      </div>
      {label && <span className={labelClass()}>{label}</span>}
    </label>
  );
};

Radio.displayName = "Radio";

export { Radio };
export type { RadioSize, RadioProps };
