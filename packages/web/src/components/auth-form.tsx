import { Form } from "@base-ui/react/form";
import { Field } from "@base-ui/react/field";
import { Input } from "@base-ui/react/input";
import { Button } from "@base-ui/react/button";
import { PageTitle, TextBody, DangerText } from "@/components/typography";

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
      className="w-full max-w-sm p-8 border border-zinc-200 rounded-xl bg-white"
      onSubmit={onSubmit}
    >
      {children}
    </Form>
  );
}

export function AuthFormTitle({ children }: { children: React.ReactNode }) {
  return <PageTitle className="mb-6 text-center">{children}</PageTitle>;
}

export function AuthFormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <DangerText
      as="div"
      className="p-3 mb-4 rounded-md bg-red-50 border border-red-200"
    >
      {message}
    </DangerText>
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
      <Field.Label className="block text-sm font-medium mb-1.5 text-zinc-700">
        {labelText}
      </Field.Label>
      <Input
        name={name}
        type={type}
        required={required}
        autoComplete={autoComplete}
        minLength={minLength}
        maxLength={maxLength}
        className="w-full py-2.5 px-3 border border-zinc-300 rounded-md text-base transition-[border-color,box-shadow] duration-150 focus:outline-none focus:border-zinc-900 focus:ring-3 focus:ring-black/10"
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
      className="w-full py-3 px-4 mt-2 border-none rounded-md text-base font-medium bg-zinc-900 text-white cursor-pointer transition-colors duration-150 hover:bg-zinc-700 disabled:bg-zinc-400 disabled:cursor-not-allowed"
    >
      {isLoading ? loadingText : children}
    </Button>
  );
}

export function AuthFormFooter({ children }: { children: React.ReactNode }) {
  return <TextBody className="mt-6 text-center">{children}</TextBody>;
}
