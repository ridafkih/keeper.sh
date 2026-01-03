"use client";

import type { FC } from "react";
import { useEffect, useState } from "react";
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
  AuthFormDivider,
  AuthSocialButton,
} from "@/components/auth-form";
import { GoogleIcon } from "@/components/icons/google";
import { useFormSubmit } from "@/hooks/use-form-submit";
import { authClient } from "@/lib/auth-client";
import { signIn, signInWithEmail, signInWithGoogle } from "@/lib/auth";
import { isCommercialMode } from "@/config/mode";
import { track } from "@/lib/analytics";

const UsernameLoginForm: FC = () => {
  const router = useRouter();
  const { refresh } = useAuth();
  const { isSubmitting, error, submit } = useFormSubmit();

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const username = String(formData.get("username") ?? "");
    const password = String(formData.get("password") ?? "");

    track("login_started", { method: "username" });
    await submit(async () => {
      await signIn(username, password);
      track("login_completed", { method: "username" });
      await refresh();
      router.push("/dashboard");
    });
  };

  return (
    <AuthForm onSubmit={handleSubmit}>
      <AuthFormTitle>Login</AuthFormTitle>
      <AuthFormError message={error} />
      <AuthFormField
        name="username"
        placeholder="Username"
        required
        autoComplete="username"
      />
      <AuthFormField
        name="password"
        placeholder="Password"
        type="password"
        required
        autoComplete="current-password"
      />
      <AuthFormSubmit isLoading={isSubmitting}>Sign in</AuthFormSubmit>
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
  );
};

const EmailLoginForm: FC = () => {
  const router = useRouter();
  const { user, refresh } = useAuth();
  const { isSubmitting, error, submit } = useFormSubmit();
  const [isRedirecting, setIsRedirecting] = useState(false);

  useEffect(() => {
    if (user) {
      router.push("/dashboard");
      return;
    }

    if (
      !PublicKeyCredential.isConditionalMediationAvailable ||
      !PublicKeyCredential.isConditionalMediationAvailable()
    ) {
      return;
    }

    const controller = new AbortController();

    void authClient.signIn
      .passkey({ autoFill: true, fetchOptions: { signal: controller.signal } })
      .then(async ({ error }) => {
        if (!error) await refresh();
      });

    return () => controller.abort();
  }, [user, refresh, router]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "");
    const password = String(formData.get("password") ?? "");

    track("login_started", { method: "email" });
    await submit(async () => {
      await signInWithEmail(email, password);
      track("login_completed", { method: "email" });
      await refresh();
      router.push("/dashboard");
    });
  };

  const handleGoogleSignIn = () => {
    track("login_started", { method: "google" });
    setIsRedirecting(true);
    void signInWithGoogle();
  };

  return (
    <AuthForm onSubmit={handleSubmit}>
      <AuthFormTitle>Login</AuthFormTitle>
      <AuthFormError message={error} />

      <AuthSocialButton
        onClick={handleGoogleSignIn}
        isLoading={isRedirecting}
        icon={<GoogleIcon className="size-4" />}
      >
        Continue with Google
      </AuthSocialButton>

      <AuthFormDivider />

      <AuthFormField
        name="email"
        placeholder="Email"
        type="email"
        required
        autoComplete="email webauthn"
      />
      <AuthFormField
        name="password"
        placeholder="Password"
        type="password"
        required
        autoComplete="current-password webauthn"
        fieldAction={
          <Link
            href="/forgot-password"
            className="text-xs text-foreground-muted hover:text-foreground"
          >
            Forgot password?
          </Link>
        }
      />

      <AuthFormSubmit isLoading={isSubmitting}>Sign in</AuthFormSubmit>

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
  );
};

const LoginPage: FC = () => (
  <div className="flex flex-col flex-1">
    <Header />
    <AuthFormContainer>
      {isCommercialMode ? <EmailLoginForm /> : <UsernameLoginForm />}
    </AuthFormContainer>
  </div>
);

export default LoginPage;
