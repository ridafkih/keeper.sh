import { Form } from "@base-ui/react/form";
import { Field } from "@base-ui/react/field";
import { Input } from "@base-ui/react/input";
import { Button } from "@base-ui/react/button";

export function AuthFormContainer({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex-1 flex flex-col items-center justify-center p-4">
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
      className="w-full max-w-xs p-4 border border-zinc-200 rounded-md bg-white"
      onSubmit={onSubmit}
    >
      {children}
    </Form>
  );
}

export function AuthFormTitle({ children }: { children: React.ReactNode }) {
  return (
    <h1 className="text-sm font-semibold text-zinc-900 tracking-tight mb-3 text-center">
      {children}
    </h1>
  );
}

export function AuthFormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="text-xs text-red-600 p-2 mb-3 rounded-md bg-red-50 border border-red-200">
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
    <Field.Root name={name} className="mb-3">
      <Field.Label className="text-xs font-medium text-zinc-600 mb-1 block">
        {labelText}
      </Field.Label>
      <Input
        name={name}
        type={type}
        required={required}
        autoComplete={autoComplete}
        minLength={minLength}
        maxLength={maxLength}
        className="w-full py-1.5 px-2 border border-zinc-300 rounded-md text-sm transition-[border-color,box-shadow] duration-150 focus:outline-none focus:border-zinc-900 focus:ring-3 focus:ring-black/10"
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
    <Button
      type="submit"
      disabled={isLoading}
      className="w-full py-1.5 px-3 mt-1 border-none rounded-md text-sm font-medium bg-zinc-900 text-white cursor-pointer transition-colors duration-150 hover:bg-zinc-700 disabled:bg-zinc-400 disabled:cursor-not-allowed"
    >
      {isLoading ? loadingText : children}
    </Button>
  );
}

export function AuthFormFooter({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-zinc-500 mt-3 text-center">{children}</p>;
}
