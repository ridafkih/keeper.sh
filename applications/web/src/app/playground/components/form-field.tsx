import type { FC, ReactNode, InputHTMLAttributes } from "react";
import { Input } from "./input";

interface FormFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  action?: ReactNode;
}

const FormField: FC<FormFieldProps> = ({ label, error, action, ...inputProps }) => (
  <div className="w-full flex flex-col gap-1.5">
    {(label || action) && (
      <div className="flex justify-between items-center">
        {label && (
          <label htmlFor={inputProps.name} className="text-sm font-medium text-neutral-700">
            {label}
          </label>
        )}
        {action}
      </div>
    )}
    <Input {...inputProps} />
    {error && <span className="text-xs text-red-600">{error}</span>}
  </div>
);

export { FormField };
