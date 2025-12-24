"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { Header } from "@/components/header";
import { useAuth } from "@/components/auth-provider";
import {
  AuthFormContainer,
  AuthForm,
  AuthFormTitle,
  AuthFormError,
  AuthFormField,
  AuthFormSubmit,
  AuthFormFooter,
} from "@/components/auth-form";
import { useFormSubmit } from "@/hooks/use-form-submit";
import { signUp } from "@/lib/auth";

export default function RegisterPage() {
  const router = useRouter();
  const { refresh } = useAuth();
  const { isSubmitting, error, submit } = useFormSubmit();

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const username = String(formData.get("username") ?? "");
    const password = String(formData.get("password") ?? "");
    const name = String(formData.get("name") ?? "") || undefined;

    await submit(async () => {
      await signUp(username, password, name);
      await refresh();
      router.push("/dashboard");
    });
  }

  return (
    <div className="flex flex-col flex-1">
      <Header />
      <AuthFormContainer>
        <AuthForm onSubmit={handleSubmit}>
          <AuthFormTitle>Register</AuthFormTitle>
          <AuthFormError message={error} />
          <AuthFormField
            name="username"
            label="Username"
            required
            minLength={3}
            maxLength={32}
            autoComplete="username"
          />
          <AuthFormField
            name="name"
            label="Name (optional)"
            autoComplete="name"
          />
          <AuthFormField
            name="password"
            label="Password"
            type="password"
            required
            minLength={8}
            maxLength={128}
            autoComplete="new-password"
          />
          <AuthFormSubmit isLoading={isSubmitting}>
            Create account
          </AuthFormSubmit>
          <AuthFormFooter>
            Already have an account?{" "}
            <Link
              href="/login"
              className="text-foreground font-medium no-underline hover:underline"
            >
              Login
            </Link>
          </AuthFormFooter>
        </AuthForm>
      </AuthFormContainer>
    </div>
  );
}
