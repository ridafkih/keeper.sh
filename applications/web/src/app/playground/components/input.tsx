import type { InputHTMLAttributes } from "react";
import { forwardRef } from "react";
import { clsx } from "clsx";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  className?: string;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, disabled, ...props }, ref) => (
    <input
      ref={ref}
      disabled={disabled}
      className={clsx(
        "w-full py-2 px-4 border border-neutral-300 rounded-full transition-colors tracking-tight",
        "focus:outline-none focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200",
        "placeholder:text-neutral-400",
        disabled && "bg-neutral-100 text-neutral-400 cursor-not-allowed",
        className,
      )}
      {...props}
    />
  ),
);

Input.displayName = "Input";

export { Input };
