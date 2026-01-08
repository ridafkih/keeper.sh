"use client";

import type { FC, FormEvent, HTMLInputAutoCompleteAttribute} from "react";
import { useEffect, useRef } from "react";
import { Provider, useStore } from "jotai";
import { FormDivider } from "../../../components/form-divider";
import { GoogleIcon } from "@/components/icons/google";
import {
  showPasswordFieldAtom,
  useSetShowPasswordField,
  useSetIsLoading,
} from "../contexts/auth-form-context";
import { EmailField } from "./email-field";
import { PasswordField } from "./password-field";
import { UsernameField } from "./username-field";
import { SubmitButton } from "./submit-button";
import { OAuthButton } from "./oauth-button";

type AuthFormVariant = "login" | "register";
type AuthFormStrategy = "commercial" | "non-commercial";

interface AuthFormProps {
  variant: AuthFormVariant;
  strategy: AuthFormStrategy;
}

const buttonText = {
  login: "Sign in",
  register: "Register",
} as const;

const getPasswordAutoCompleteType = (variant: AuthFormVariant): HTMLInputAutoCompleteAttribute => {
  switch (variant) {
      case "login": {
        return "current-password"
      }
      case "register": {
        return "password"
      }
  }
}

const AuthFormInternal: FC<AuthFormProps> = ({ variant, strategy }) => {
  const store = useStore();
  const setShowPasswordField = useSetShowPasswordField();
  const setIsLoading = useSetIsLoading();
  const formRef = useRef<HTMLFormElement>(null);

  const handleGoogleSignIn = () => {
    // TODO: Google OAuth
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (strategy === "non-commercial") {
      const showPasswordField = store.get(showPasswordFieldAtom);
      if (!showPasswordField) {
        setShowPasswordField(true);
        return;
      }

      setIsLoading(true);
      const formData = new FormData(event.currentTarget);
      const username = formData.get("username");
      const password = formData.get("password");
      // TODO: non-commercial auth logic
    } else {
      setIsLoading(true);
      const formData = new FormData(event.currentTarget);
      const email = formData.get("email");
      // TODO: commercial auth logic (email verification)
    }
  };

  useEffect(() => {
    formRef.current?.reset();
    setShowPasswordField(false);
    setIsLoading(false);
  }, [setShowPasswordField, setIsLoading]);

  if (strategy === "non-commercial") {
    return (
      <form ref={formRef} onSubmit={handleSubmit} className="flex flex-col gap-2">
        <UsernameField />
        <PasswordField type="password" autoComplete={getPasswordAutoCompleteType(variant)} />
        <SubmitButton>{buttonText[variant]}</SubmitButton>
      </form>
    );
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="flex flex-col gap-2">
      <OAuthButton
        onSignIn={handleGoogleSignIn}
        icon={<GoogleIcon className="size-4" />}
      >
        Continue with Google
      </OAuthButton>
      <FormDivider />
      <EmailField />
      <SubmitButton>{buttonText[variant]}</SubmitButton>
    </form>
  );
};

const AuthForm: FC<AuthFormProps> = ({ ...props }) => (
    <Provider>
      <AuthFormInternal {...props} />
    </Provider>
  )

export { AuthForm }
