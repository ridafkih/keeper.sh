import type { ReactNode, InputHTMLAttributes } from "react";
import { useId } from "react";
import { Input } from "./input";
import type { InputSize } from "./input";
import { Copy } from "./copy";

interface FormFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  label?: string;
  error?: string;
  action?: ReactNode;
  size?: InputSize;
  ref?: React.Ref<HTMLInputElement>;
}

const FormField = ({ label, error, action, ref, ...inputProps }: FormFieldProps) => {
  const generatedId = useId();
  const inputId = inputProps.id || inputProps.name || generatedId;
  const errorId = error ? `${inputId}-error` : undefined;

  return (
    <div className="w-full flex flex-col gap-1.5">
      {(label || action) && (
        <div className="flex justify-between items-center">
          {label && (
            <label htmlFor={inputId} className="text-sm font-medium text-foreground-secondary">
              {label}
            </label>
          )}
          {action}
        </div>
      )}
      <Input
        ref={ref}
        id={inputId}
        aria-invalid={error ? "true" : undefined}
        aria-describedby={errorId}
        {...inputProps}
      />
      {error && (
        <Copy as="span" id={errorId} size="xs" color="error" role="alert">
          {error}
        </Copy>
      )}
    </div>
  );
};

FormField.displayName = "FormField";

export { FormField };
