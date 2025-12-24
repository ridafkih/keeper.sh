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
import { signIn } from "@/lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const { refresh } = useAuth();
  const { isSubmitting, error, submit } = useFormSubmit();

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const username = String(formData.get("username") ?? "");
    const password = String(formData.get("password") ?? "");

    await submit(async () => {
      await signIn(username, password);
      await refresh();
      router.push("/dashboard");
    });
  }

  return (
    <div className="flex flex-col flex-1">
      <Header />
      <AuthFormContainer>
        <AuthForm onSubmit={handleSubmit}>
          <AuthFormTitle>Login</AuthFormTitle>
          <AuthFormError message={error} />
          <AuthFormField
            name="username"
            label="Username"
            required
            autoComplete="username"
          />
          <AuthFormField
            name="password"
            label="Password"
            type="password"
            required
            autoComplete="current-password"
          />
          <AuthFormSubmit isLoading={isSubmitting}>
            Sign in
          </AuthFormSubmit>
          <AuthFormFooter>
            Don&apos;t have an account?{" "}
            <Link
              href="/register"
              className="text-foreground font-medium no-underline hover:underline"
            >
              Register
            </Link>
          </AuthFormFooter>
        </AuthForm>
      </AuthFormContainer>
    </div>
  );
}
