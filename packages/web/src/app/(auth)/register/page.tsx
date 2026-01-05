"use client";

import type { FC, ReactNode } from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/components/auth-provider";
import {
  AuthForm,
  AuthFormContainer,
  AuthFormDivider,
  AuthFormError,
  AuthFormField,
  AuthFormFooter,
  AuthFormSubmit,
  AuthFormTitle,
  AuthSocialButton,
} from "@/components/auth-form";
import { GoogleIcon } from "@/components/icons/google";
import { useFormSubmit } from "@/hooks/use-form-submit";
import { signInWithGoogle, signUp } from "@/lib/auth";
import { isCommercialMode } from "@/config/mode";
import { track } from "@/lib/analytics";

const UsernameRegisterForm: FC = () => {
  const router = useRouter();
  const { refresh } = useAuth();
  const { isSubmitting, error, submit } = useFormSubmit();

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const username = String(formData.get("username") ?? "");
    const password = String(formData.get("password") ?? "");

    track("registration_started", { method: "username" });
    await submit(async () => {
      await signUp(username, password);
      track("registration_completed");
      await refresh();
      router.push("/dashboard");
    });
  };

  return (
    <AuthForm onSubmit={handleSubmit}>
      <AuthFormTitle>Register</AuthFormTitle>
      <AuthFormError message={error} />
      <AuthFormField
        name="username"
        placeholder="Username"
        required
        minLength={3}
        maxLength={32}
        pattern="^[a-zA-Z0-9._-]+$"
        autoComplete="username"
      />
      <AuthFormField
        name="password"
        placeholder="Password"
        type="password"
        required
        minLength={8}
        maxLength={128}
        autoComplete="new-password"
      />
      <AuthFormSubmit isLoading={isSubmitting}>Create account</AuthFormSubmit>
      <AuthFormFooter>
        Already have an account?{" "}
        <Link href="/login" className="text-foreground font-medium no-underline hover:underline">
          Login
        </Link>
      </AuthFormFooter>
    </AuthForm>
  );
};

const EmailRegisterForm: FC = () => {
  const router = useRouter();
  const [isRedirecting, setIsRedirecting] = useState(false);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "");
    track("registration_started", { method: "email" });
    sessionStorage.setItem("registrationEmail", email);
    router.push("/register/complete");
  };

  const handleGoogleSignIn = (): void => {
    track("registration_started", { method: "google" });
    setIsRedirecting(true);
    void signInWithGoogle();
  };

  return (
    <AuthForm onSubmit={handleSubmit}>
      <AuthFormTitle>Register</AuthFormTitle>

      <AuthSocialButton
        onClick={handleGoogleSignIn}
        isLoading={isRedirecting}
        icon={<GoogleIcon className="size-4" />}
      >
        Continue with Google
      </AuthSocialButton>

      <AuthFormDivider />

      <AuthFormField name="email" placeholder="Email" type="email" required autoComplete="email" />

      <AuthFormSubmit isLoading={false}>Continue</AuthFormSubmit>

      <AuthFormFooter>
        Already have an account?{" "}
        <Link href="/login" className="text-foreground font-medium no-underline hover:underline">
          Login
        </Link>
      </AuthFormFooter>
    </AuthForm>
  );
};

const RegisterPage = (): ReactNode => {
  const formComponent = ((): ReactNode => {
    if (isCommercialMode) {
      return <EmailRegisterForm />;
    }
    return <UsernameRegisterForm />;
  })();
  return <AuthFormContainer>{formComponent}</AuthFormContainer>;
};

export default RegisterPage;
