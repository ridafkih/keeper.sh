import { Form } from "@base-ui-components/react/form";
import { Field } from "@base-ui-components/react/field";
import { Input } from "@base-ui-components/react/input";
import { Button } from "@base-ui-components/react/button";
import { input, label, submitButton } from "@/styles";

export function AuthFormContainer({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex-1 flex flex-col items-center justify-center p-8">
      {children}
    </main>
  );
}

export function AuthForm({
  onSubmit,
  children,
}: {
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  children: React.ReactNode;
}) {
  return (
    <Form
      className="w-full max-w-sm p-8 border border-neutral-200 rounded-xl bg-white"
      onSubmit={onSubmit}
    >
      {children}
    </Form>
  );
}

export function AuthFormTitle({ children }: { children: React.ReactNode }) {
  return <h1 className="text-2xl font-bold mb-6 text-center">{children}</h1>;
}

export function AuthFormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="p-3 mb-4 rounded-md text-sm bg-red-50 text-red-600 border border-red-200">
      {message}
    </div>
  );
}

export function AuthFormField({
  name,
  label: labelText,
  type = "text",
  required = false,
  autoComplete,
  minLength,
  maxLength,
}: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  autoComplete?: string;
  minLength?: number;
  maxLength?: number;
}) {
  return (
    <Field.Root name={name} className="mb-4">
      <Field.Label className={label()}>{labelText}</Field.Label>
      <Input
        name={name}
        type={type}
        required={required}
        autoComplete={autoComplete}
        minLength={minLength}
        maxLength={maxLength}
        className={input()}
      />
    </Field.Root>
  );
}

export function AuthFormSubmit({
  isLoading,
  children,
  loadingText,
}: {
  isLoading: boolean;
  children: React.ReactNode;
  loadingText: string;
}) {
  return (
    <Button type="submit" disabled={isLoading} className={submitButton()}>
      {isLoading ? loadingText : children}
    </Button>
  );
}

export function AuthFormFooter({ children }: { children: React.ReactNode }) {
  return <p className="mt-6 text-center text-sm text-gray-500">{children}</p>;
}
