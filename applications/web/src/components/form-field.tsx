import type { FC } from "react";
import { FieldLabel } from "@/components/typography";
import { input } from "@/styles";

interface FormFieldProps {
  id: string;
  name: string;
  label: string;
  type: "text" | "password" | "email" | "url";
  value?: string;
  defaultValue?: string;
  onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  required?: boolean;
  autoComplete?: string;
  minLength?: number;
  maxLength?: number;
  readOnly?: boolean;
}

export const FormField: FC<FormFieldProps> = ({
  id,
  name,
  label: labelText,
  type,
  value,
  defaultValue,
  onChange,
  placeholder,
  required,
  autoComplete,
  minLength,
  maxLength,
  readOnly,
}) => (
  <div className="flex flex-col gap-1">
    <FieldLabel htmlFor={id}>{labelText}</FieldLabel>
    <input
      id={id}
      name={name}
      type={type}
      value={value}
      defaultValue={defaultValue}
      onChange={onChange}
      placeholder={placeholder}
      required={required}
      autoComplete={autoComplete}
      minLength={minLength}
      maxLength={maxLength}
      readOnly={readOnly}
      className={input({ readonly: readOnly, size: "sm" })}
    />
  </div>
);
