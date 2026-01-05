"use client";

import { useEffect, useRef } from "react";
import type { FC, PropsWithChildren } from "react";
import { Form } from "@base-ui/react/form";
import { Field } from "@base-ui/react/field";
import { Input } from "@base-ui/react/input";
import { Checkbox } from "@base-ui/react/checkbox";
import { Check } from "lucide-react";
import { tv } from "tailwind-variants";
import { Button } from "@/components/button";
import { CardTitle, DangerText, TextBody } from "@/components/typography";

const authFormSubmit = tv({
  base: "w-full py-1.5 px-3 border-none rounded-md text-sm font-medium bg-primary text-primary-foreground cursor-pointer transition-colors duration-150 hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed",
});

const authFormInput = tv({
  base: "w-full py-1.5 px-2 border border-border-input rounded-md text-sm transition-[border-color,box-shadow] duration-150 focus:outline-none focus:border-border-emphasis focus:ring-3 focus:ring-focus-ring text-foreground",
  variants: {
    disabled: {
      true: "bg-surface-subtle text-foreground-muted cursor-not-allowed",
    },
  },
});

const AuthFormContainer: FC<PropsWithChildren> = ({ children }) => (
  <main className="flex-1 flex flex-col items-center justify-center p-4">{children}</main>
);

interface AuthFormProps {
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}

const AuthForm: FC<PropsWithChildren<AuthFormProps>> = ({ onSubmit, children }) => {
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const form = formRef.current;
    if (!form) {
      return;
    }

    form.reset();

    const handlePageShow = (event: PageTransitionEvent): void => {
      if (event.persisted) {
        form.reset();
      }
    };

    window.addEventListener("pageshow", handlePageShow);
    return (): void => window.removeEventListener("pageshow", handlePageShow);
  }, []);

  return (
    <Form
      ref={formRef}
      className="w-full max-w-xs p-4 rounded-md bg-surface flex flex-col gap-2"
      onSubmit={onSubmit}
    >
      {children}
    </Form>
  );
};

const AuthFormTitle: FC<PropsWithChildren> = ({ children }) => (
  <CardTitle as="h1" className="text-center">
    {children}
  </CardTitle>
);

interface AuthFormErrorProps {
  message: string | null;
}

const AuthFormError: FC<AuthFormErrorProps> = ({ message }) => {
  if (!message) {
    return;
  }
  return (
    <div className="px-2 py-1 rounded-md bg-destructive-surface border border-destructive-border">
      <DangerText className="text-xs">{message}</DangerText>
    </div>
  );
};

interface AuthFormFieldProps {
  name: string;
  placeholder: string;
  fieldAction?: React.ReactNode;
  type?: string;
  required?: boolean;
  autoComplete?: string;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  disabled?: boolean;
  defaultValue?: string;
  value?: string;
  _autoFocus?: boolean;
  inputRef?: React.Ref<HTMLInputElement>;
}

const AuthFormField: FC<AuthFormFieldProps> = ({
  name,
  placeholder,
  fieldAction,
  type = "text",
  required = false,
  autoComplete,
  minLength,
  maxLength,
  pattern,
  disabled,
  defaultValue,
  value,
  _autoFocus,
  inputRef,
}) => (
  <Field.Root name={name} className="flex flex-col gap-1">
    <Input
      ref={inputRef}
      name={name}
      type={type}
      placeholder={placeholder}
      required={required}
      autoComplete={autoComplete}
      minLength={minLength}
      maxLength={maxLength}
      pattern={pattern}
      disabled={disabled}
      defaultValue={defaultValue}
      value={value}
      className={authFormInput({ disabled })}
    />
    {fieldAction}
  </Field.Root>
);

interface AuthFormSubmitProps {
  isLoading: boolean;
}

const AuthFormSubmit: FC<PropsWithChildren<AuthFormSubmitProps>> = ({ isLoading, children }) => (
  <Button type="submit" isLoading={isLoading} className={authFormSubmit()}>
    {children}
  </Button>
);

const AuthFormFooter: FC<PropsWithChildren> = ({ children }) => (
  <TextBody className="text-xs text-center">{children}</TextBody>
);

const AuthFormDivider: FC = () => (
  <div className="flex items-center gap-3">
    <div className="flex-1 h-px bg-border" />
    <span className="text-xs text-foreground-muted">or</span>
    <div className="flex-1 h-px bg-border" />
  </div>
);

const authSocialButton = tv({
  base: "w-full py-1.5 px-3 flex items-center justify-center gap-2 border border-border rounded-md text-sm font-medium bg-surface cursor-pointer transition-colors duration-150 hover:bg-surface-subtle disabled:opacity-50 disabled:cursor-not-allowed text-foreground",
});

interface AuthSocialButtonProps {
  onClick: () => void;
  isLoading?: boolean;
  icon: React.ReactNode;
}

const AuthSocialButton: FC<PropsWithChildren<AuthSocialButtonProps>> = ({
  onClick,
  isLoading,
  icon,
  children,
}) => (
  <button type="button" onClick={onClick} disabled={isLoading} className={authSocialButton()}>
    {icon}
    {children}
  </button>
);

const authFormCheckbox = tv({
  slots: {
    box: "size-4 flex items-center justify-center rounded border border-border-input transition-colors data-[checked]:bg-primary data-[checked]:border-primary",
    indicator: "text-primary-foreground",
    label: "text-xs text-foreground-secondary select-none",
    root: "flex items-center gap-2 cursor-pointer",
  },
});

interface AuthFormCheckboxProps {
  name: string;
  label: React.ReactNode;
  defaultChecked?: boolean;
}

const AuthFormCheckbox: FC<AuthFormCheckboxProps> = ({ name, label, defaultChecked = false }) => {
  const styles = authFormCheckbox();

  return (
    <label className={styles.root()}>
      <Checkbox.Root name={name} defaultChecked={defaultChecked} className={styles.box()}>
        <Checkbox.Indicator>
          <Check size={12} className={styles.indicator()} />
        </Checkbox.Indicator>
      </Checkbox.Root>
      <span className={styles.label()}>{label}</span>
    </label>
  );
};

export {
  AuthFormContainer,
  AuthForm,
  AuthFormTitle,
  AuthFormError,
  AuthFormField,
  AuthFormSubmit,
  AuthFormFooter,
  AuthFormDivider,
  AuthSocialButton,
  AuthFormCheckbox,
};
