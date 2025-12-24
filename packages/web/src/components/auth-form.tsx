import type { FC, PropsWithChildren } from "react";
import { Form } from "@base-ui/react/form";
import { Field } from "@base-ui/react/field";
import { Input } from "@base-ui/react/input";
import { tv } from "tailwind-variants";
import { Button } from "@/components/button";
import { CardTitle, FieldLabel, TextBody, DangerText } from "@/components/typography";

const authFormSubmit = tv({
  base: "w-full py-1.5 px-3 mt-1 border-none rounded-md text-sm font-medium bg-primary text-primary-foreground cursor-pointer transition-colors duration-150 hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed",
});

const authFormInput = tv({
  base: "w-full py-1.5 px-2 border border-border-input rounded-md text-sm transition-[border-color,box-shadow] duration-150 focus:outline-none focus:border-border-emphasis focus:ring-3 focus:ring-focus-ring",
});

export const AuthFormContainer: FC<PropsWithChildren> = ({ children }) => (
  <main className="flex-1 flex flex-col items-center justify-center p-4">
    {children}
  </main>
);

interface AuthFormProps {
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}

export const AuthForm: FC<PropsWithChildren<AuthFormProps>> = ({
  onSubmit,
  children,
}) => (
  <Form
    className="w-full max-w-xs p-4 border border-border rounded-md bg-surface"
    onSubmit={onSubmit}
  >
    {children}
  </Form>
);

export const AuthFormTitle: FC<PropsWithChildren> = ({ children }) => (
  <CardTitle as="h1" className="mb-3 text-center">
    {children}
  </CardTitle>
);

interface AuthFormErrorProps {
  message: string | null;
}

export const AuthFormError: FC<AuthFormErrorProps> = ({ message }) => {
  if (!message) return null;
  return (
    <div className="p-2 mb-3 rounded-md bg-destructive-surface border border-destructive-border">
      <DangerText className="text-xs">{message}</DangerText>
    </div>
  );
};

interface AuthFormFieldProps {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  autoComplete?: string;
  minLength?: number;
  maxLength?: number;
}

export const AuthFormField: FC<AuthFormFieldProps> = ({
  name,
  label: labelText,
  type = "text",
  required = false,
  autoComplete,
  minLength,
  maxLength,
}) => (
  <Field.Root name={name} className="mb-3">
    <FieldLabel as="span" className="mb-1 block">
      {labelText}
    </FieldLabel>
    <Input
      name={name}
      type={type}
      required={required}
      autoComplete={autoComplete}
      minLength={minLength}
      maxLength={maxLength}
      className={authFormInput()}
    />
  </Field.Root>
);

interface AuthFormSubmitProps {
  isLoading: boolean;
}

export const AuthFormSubmit: FC<PropsWithChildren<AuthFormSubmitProps>> = ({
  isLoading,
  children,
}) => (
  <Button type="submit" isLoading={isLoading} className={authFormSubmit()}>
    {children}
  </Button>
);

export const AuthFormFooter: FC<PropsWithChildren> = ({ children }) => (
  <TextBody className="text-xs mt-3 text-center">{children}</TextBody>
);
