import type { InputHTMLAttributes, Ref } from "react";
import { clsx } from "clsx";

type InputSize = "default" | "small";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  className?: string;
  inputSize?: InputSize;
  ref?: Ref<HTMLInputElement>;
}

const sizeStyles: Record<InputSize, string> = {
  default: "py-2 px-4 text-base",
  small: "py-1.5 px-3 text-sm",
};

const Input = ({ className, disabled, inputSize = "default", ref, ...props }: InputProps) => (
  <input
    ref={ref}
    disabled={disabled}
    className={clsx(
      "w-full border border-neutral-300 rounded-xl transition-colors bg-white",
      "focus:outline-none focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200",
      "placeholder:text-neutral-400 tracking-normal",
      sizeStyles[inputSize],
      disabled && "bg-neutral-100 text-neutral-400 cursor-not-allowed opacity-75",
      className,
    )}
    {...props}
  />
);

export { Input };
export type { InputSize };
